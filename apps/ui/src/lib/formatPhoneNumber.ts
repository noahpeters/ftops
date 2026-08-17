export function formatPhoneNumber(value: string | null | undefined): string | null {
  const original = value?.trim();
  if (!original) return null;

  const digits = original.replace(/\D/g, "");
  const nationalNumber =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith("1")
        ? digits.slice(1)
        : null;

  if (!nationalNumber) return original;

  return `+1 (${nationalNumber.slice(0, 3)}) ${nationalNumber.slice(3, 6)}-${nationalNumber.slice(6)}`;
}
