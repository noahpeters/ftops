import { expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import { classifyCustomer, parseQualification } from "../../src/services/customerQualification";
const prediction = {
  model: "jev-test",
  answers: {
    scope: {
      choice: "qualified",
      confidence: 0.95,
      probabilities: { qualified: 0.95, not_qualified: 0.03, unclear: 0.02 },
    },
  },
};
function request(
  env: Parameters<typeof route>[1],
  path: string,
  body?: unknown,
  headers?: HeadersInit
) {
  return route(
    new Request(`http://localhost${path}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    {} as ExecutionContext
  );
}
it("retains original classifications and append-only evaluations without teaching later classifications", async () => {
  const context = await createTestEnv();
  if (!context) throw new Error("Local database emulator required");
  const { env, db, mf } = context;
  try {
    const created = await request(env, "/customers", {
      workspaceId: "default",
      displayName: "Test lead",
      notes: "A custom walnut dining table.",
    });
    const { customer } = (await created.json()) as { customer: { id: string } };
    env.AI = { run: vi.fn().mockResolvedValue(prediction) };
    let result = await request(env, `/customers/${customer.id}/qualification`, {
      action: "classify",
    });
    expect(result.status).toBe(200);
    const data = (await result.json()) as {
      qualification: { current: { id: string; classification: string } };
    };
    const id = data.qualification.current.id;
    expect(data.qualification.current.classification).toBe("qualified");
    result = await request(env, `/customers/${customer.id}/qualification`, {
      action: "review",
      assessmentId: id,
      verdict: "incorrect",
      expectedClassification: "not_qualified",
    });
    expect(result.status).toBe(200);
    result = await request(env, `/customers/${customer.id}/qualification`, {
      action: "review",
      assessmentId: id,
      verdict: "correct",
    });
    expect(result.status).toBe(200);
    const history = (await (
      await request(env, `/customers/${customer.id}/qualification`)
    ).json()) as {
      current: { classification: string };
      reviews: Array<{ verdict: string; reviewed_by: string; expected_classification: string }>;
    };
    expect(history.current.classification).toBe("qualified");
    expect(history.reviews).toHaveLength(2);
    expect(
      history.reviews.some(
        (r) =>
          r.verdict === "incorrect" &&
          r.expected_classification === "not_qualified" &&
          !!r.reviewed_by
      )
    ).toBe(true);
    await classifyCustomer(env, "default", customer.id);
    const mock = vi.mocked(env.AI.run);
    expect(mock.mock.calls[0]).toEqual(mock.mock.calls[1]);
    expect(
      await db.prepare("SELECT count(*) AS n FROM customer_qualification_assessments").first()
    ).toEqual({ n: 2 });
    expect(
      await db
        .prepare(
          "SELECT rules_version,input_snapshot,model FROM customer_qualification_assessments LIMIT 1"
        )
        .first()
    ).toMatchObject({
      rules_version: "from-trees-project-scope-v1",
      input_snapshot: "A custom walnut dining table.",
      model: "jev-test",
    });
    const list = (await (await request(env, "/customers?workspaceId=default")).json()) as Array<{
      qualification_classification: string;
    }>;
    expect(list[0].qualification_classification).toBe("qualified");
    expect(
      (
        await request(env, `/customers/${customer.id}/qualification`, {
          action: "review",
          assessmentId: id,
          verdict: "incorrect",
          expectedClassification: "qualified",
        })
      ).status
    ).toBe(400);
    const other = (await (
      await request(env, "/customers", { workspaceId: "default", displayName: "Other" })
    ).json()) as { customer: { id: string } };
    expect(
      (
        await request(env, `/customers/${other.customer.id}/qualification`, {
          action: "review",
          assessmentId: id,
          verdict: "correct",
        })
      ).status
    ).toBe(404);
  } finally {
    await mf.dispose();
  }
});
it("preserves no assessment on unavailable AI, missing descriptions and malformed responses", async () => {
  const context = await createTestEnv();
  if (!context) throw new Error("Local database emulator required");
  const { env, db, mf } = context;
  try {
    const created = (await (
      await request(env, "/customers", { workspaceId: "default", displayName: "Empty" })
    ).json()) as { customer: { id: string } };
    await expect(classifyCustomer(env, "default", created.customer.id)).rejects.toThrow(
      "qualification_ai_unavailable"
    );
    env.AI = { run: vi.fn().mockResolvedValue(prediction) };
    await expect(classifyCustomer(env, "default", created.customer.id)).rejects.toThrow(
      "qualification_description_missing"
    );
    expect(
      await db.prepare("SELECT count(*) AS n FROM customer_qualification_assessments").first()
    ).toEqual({ n: 0 });
  } finally {
    await mf.dispose();
  }
  expect(
    parseQualification({
      ...prediction,
      answers: { scope: { ...prediction.answers.scope, confidence: 0.5 } },
    }).classification
  ).toBe("unclear");
  for (const invalid of [
    null,
    {},
    { answers: { scope: { choice: "qualified", confidence: 2 } } },
    {
      answers: {
        scope: {
          ...prediction.answers.scope,
          probabilities: { qualified: NaN, not_qualified: 0, unclear: 0 },
        },
      },
    },
  ])
    expect(() => parseQualification(invalid)).toThrow();
});
