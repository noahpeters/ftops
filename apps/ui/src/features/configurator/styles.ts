import stylex from "~/lib/stylex";
export const styles = stylex.create({
  dashboard: {
    padding: "32px",
    maxWidth: "1560px",
    margin: "auto",
    color: "#302f29",
    "@media (max-width: 540px)": {
      padding: "20px 14px",
    },
  },
  heading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "24px",
    marginBottom: "28px",
    "@media (max-width: 900px)": {
      alignItems: "start",
      flexDirection: "column",
    },
  },
  title: {
    fontSize: "30px",
    letterSpacing: "-0.04em",
    margin: "4px 0 8px",
    "@media (max-width: 540px)": {
      fontSize: "25px",
    },
  },
  intro: {
    color: "#706d64",
    margin: "4px 0",
    fontSize: "14px",
  },
  cardIntro: {
    color: "#706d64",
    margin: "4px 0",
    fontSize: "12px",
    marginTop: "7px",
  },
  eyebrow: {
    fontSize: "10px",
    letterSpacing: "0.16em",
    fontWeight: "600",
  },
  controls: {
    display: "flex",
    gap: "10px",
    alignItems: "end",
  },
  controlLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    fontSize: "12px",
  },
  button: {
    fontFamily: "inherit",
    fontSize: "inherit",
    cursor: "pointer",
    ":disabled": {
      opacity: "0.5",
      cursor: "default",
    },
  },
  formFont: {
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  controlButton: {
    backgroundColor: "#fffdf8",
    border: "1px solid #d8d3c8",
    borderRadius: "6px",
    padding: "9px 14px",
    color: "#3f4434",
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: "12px",
    "@media (max-width: 1200px)": {
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    },
    "@media (max-width: 540px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: "8px",
    },
  },
  metric: {
    backgroundColor: "#fffdf8",
    border: "1px solid #e0dbd0",
    borderRadius: "8px",
    padding: "18px 16px",
    "@media (max-width: 540px)": {
      padding: "14px",
    },
  },
  metricLabel: {
    fontSize: "12px",
    fontWeight: "500",
    margin: "0 0 14px",
    color: "#706d64",
  },
  metricValue: {
    fontSize: "32px",
    fontWeight: "500",
    letterSpacing: "-0.04em",
  },
  metricNote: {
    fontSize: "11px",
    color: "#767268",
    lineHeight: "1.5",
    margin: "8px 0 0",
  },
  coverage: {
    fontSize: "12px",
    color: "#777469",
    lineHeight: "1.65",
    margin: "14px 0 24px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1.2fr",
    gap: "18px",
    "@media (max-width: 900px)": {
      gridTemplateColumns: "1fr",
    },
  },
  card: {
    backgroundColor: "#fffdf8",
    border: "1px solid #e0dbd0",
    borderRadius: "10px",
    padding: "22px",
    marginBottom: "20px",
    minWidth: "0",
    "@media (max-width: 540px)": {
      padding: "16px",
    },
  },
  cardHeading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    gap: "16px",
    marginBottom: "18px",
    "@media (max-width: 540px)": {
      flexWrap: "wrap",
    },
  },
  cardTitle: {
    fontSize: "17px",
    fontWeight: "500",
    margin: "0",
  },
  cardMeta: {
    fontSize: "11px",
    color: "#79766d",
    whiteSpace: "nowrap",
  },
  chart: {
    display: "flex",
    gap: "3px",
    height: "170px",
    alignItems: "end",
    borderBottom: "1px solid #e2ddd3",
  },
  barColumn: {
    flex: "1",
    minWidth: "1px",
    height: "100%",
    display: "flex",
    alignItems: "end",
  },
  bar: {
    backgroundColor: "#727e62",
    width: "100%",
    borderRadius: "3px 3px 0 0",
  },
  chartLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    color: "#79766d",
    marginTop: "10px",
  },
  tableScroll: {
    overflow: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: "13px",
  },
  th: {
    textAlign: "left",
    color: "#79766d",
    fontSize: "11px",
    fontWeight: "500",
    padding: "0 12px 12px 0",
    whiteSpace: "nowrap",
  },
  td: {
    borderTop: "1px solid #ece7dc",
    padding: "12px 12px 12px 0",
    verticalAlign: "top",
  },
  tableStrong: {
    fontWeight: "500",
  },
  tableSmall: {
    display: "block",
    marginTop: "4px",
    color: "#817c70",
    overflowWrap: "anywhere",
  },
  footnote: {
    fontSize: "11px",
    color: "#827c70",
    lineHeight: "1.6",
  },
  designs: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "16px",
    "@media (max-width: 1200px)": {
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    },
    "@media (max-width: 900px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
    "@media (max-width: 540px)": {
      gridTemplateColumns: "1fr",
    },
  },
  design: {
    height: "auto",
    minHeight: "0",
    padding: "0",
    overflow: "hidden",
    textAlign: "left",
    backgroundColor: "#f5f1e8",
    border: "1px solid #e2dccf",
    borderRadius: "7px",
    color: "inherit",
    ":hover": {
      borderColor: "#7a806a",
      boxShadow: "0 2px 10px #383e3210",
    },
  },
  plan: {
    display: "block",
    width: "100%",
    height: "185px",
    padding: "18px",
    boxSizing: "border-box",
  },
  designInfo: {
    padding: "12px 14px",
    backgroundColor: "#fffdf8",
  },
  designTitle: {
    fontSize: "12px",
    fontWeight: "500",
    display: "block",
  },
  designMeta: {
    fontSize: "10px",
    color: "#7b766c",
    display: "block",
    marginTop: "5px",
  },
  planEmpty: {
    height: "185px",
    display: "grid",
    placeItems: "center",
    fontSize: "12px",
    color: "#777",
  },
  empty: {
    padding: "24px 0",
    color: "#7d786e",
    fontSize: "13px",
  },
  textButton: {
    backgroundColor: "none",
    border: "0",
    textDecoration: "underline",
    color: "#596445",
    padding: "0",
    whiteSpace: "nowrap",
  },
  pagination: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    fontSize: "12px",
    color: "#79766d",
  },
  dialog: {
    border: "1px solid #d7d0c1",
    borderRadius: "12px",
    padding: "24px",
    width: "min(700px, 85vw)",
    color: "#302f29",
    backgroundColor: "#fffdf8",
    "::backdrop": {
      backgroundColor: "#252a2377",
    },
  },
  dialogPlan: {
    height: "min(58vh, 500px)",
    backgroundColor: "#f3efe6",
    borderRadius: "8px",
  },
  dialogText: {
    fontSize: "13px",
  },
  notice: {
    padding: "24px",
    backgroundColor: "#fffdf8",
    border: "1px solid #e0dbd0",
    borderRadius: "8px",
  },
  noticeTitle: {
    fontSize: "18px",
  },
  focus: {
    ":focus-visible": {
      outline: "2px solid #63724f",
      outlineOffset: "3px",
    },
  },
  paginationMeta: {
    "@media (max-width: 540px)": {
      display: "none",
    },
  },
});
