// Shared rules for resident details and passwords. The database enforces the same rules
// (see is_valid_* functions in supabase/schema.sql), so bypassing the forms does not bypass them.

const LETTERS = "A-Za-zÀ-ÖØ-öø-ÿ";
// Letters, with single spaces, hyphens, apostrophes or "Ma. " style periods between parts.
const NAME = new RegExp(`^[${LETTERS}]+(?:(?:\\. ?|[ '-])[${LETTERS}]+)*\\.?$`);
const REPEATED = /(.)\1{3,}/i;
const PH_MOBILE = /^(?:09\d{9}|\+639\d{9})$/;
const UNIT = /^(?:[1-9]\d{0,3}[A-Za-z]?|[A-Za-z])$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const EMAIL_TYPO_DOMAINS = ["gmai.com", "gmial.com", "gmal.com", "gamil.com", "gnail.com", "gmail.co", "gmsail.com", "yaho.com", "yahooo.com", "hotmal.com"];
const EMAIL_TYPO_TLDS = ["con", "cmo", "comm", "om"];

export const LIMITS = { name: 50, email: 254, phone: 16, unit: 10, passwordMin: 8, passwordMax: 72 };

export const normalizePhone = (value: string) => value.replace(/[\s()-]/g, "");
// Accept "Block 23" / "Lot 7" and keep just the number.
export const normalizeUnit = (value: string) => value.trim().replace(/^(?:block|blk|lot)\.?\s*/i, "");
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export function nameError(label: string, value: string) {
  const name = value.trim();
  if (!name) return `${label} is required.`;
  if (name.length > LIMITS.name) return `${label} must be ${LIMITS.name} characters or fewer.`;
  if (!NAME.test(name)) return `${label} can only contain letters, spaces, hyphens, apostrophes and periods.`;
  if (REPEATED.test(name)) return `${label} has too many repeated characters.`;
  return null;
}

export function emailError(value: string) {
  const email = normalizeEmail(value);
  if (email.length > LIMITS.email || !EMAIL.test(email)) return "Enter a valid email address.";
  const domain = email.split("@")[1];
  if (EMAIL_TYPO_DOMAINS.includes(domain) || EMAIL_TYPO_TLDS.includes(domain.split(".").pop() || "")) return "Check your email address for typos.";
  return null;
}

export function phoneError(value: string) {
  return PH_MOBILE.test(normalizePhone(value)) ? null : "Enter a Philippine mobile number, e.g. 09171234567.";
}

export function unitError(label: string, value: string) {
  return UNIT.test(normalizeUnit(value)) ? null : `${label} must be a number such as 23 or 23A.`;
}

export function passwordError(value: string) {
  if (value.length < LIMITS.passwordMin) return `Password must contain at least ${LIMITS.passwordMin} characters.`;
  if (value.length > LIMITS.passwordMax) return `Password must be ${LIMITS.passwordMax} characters or fewer.`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "Password must include at least one letter and one number.";
  return null;
}

export type ResidentDetails = { firstName: string; lastName: string; email: string; phone: string; block: string; lot: string };

// Returns the first problem found, or null when every field is valid.
export function residentError(details: ResidentDetails) {
  return nameError("First name", details.firstName) || nameError("Last name", details.lastName) || emailError(details.email)
    || phoneError(details.phone) || unitError("Block", details.block) || unitError("Lot", details.lot);
}
