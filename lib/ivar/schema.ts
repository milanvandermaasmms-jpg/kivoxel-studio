// Small input schemas for Ivar's tools: validated on the worker before anything runs, and sent to Gemini as the
// function declaration. Only what the tools need: objects of strings, integers, booleans and arrays. Pure.

export type Field =
  | { type: "string"; description?: string; maxLength: number; minLength?: number; enum?: readonly string[]; pattern?: RegExp }
  | { type: "integer"; description?: string; min: number; max: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: Field; maxItems: number; minItems?: number }
  | { type: "object"; description?: string; properties: Record<string, Field>; required?: readonly string[] };

export type ObjectSchema = Extract<Field, { type: "object" }>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (description: string): Field => ({ type: "string", description, maxLength: 36, pattern: UUID });

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function check(field: Field, value: unknown, path: string): Result<unknown> {
  const fail = (why: string): Result<unknown> => ({ ok: false, error: `${path || "invoer"}: ${why}` });
  switch (field.type) {
    case "string": {
      if (typeof value !== "string") return fail("moet tekst zijn");
      const v = value.replace(/\u0000/g, "").trim();
      if (v.length > field.maxLength) return fail(`hooguit ${field.maxLength} tekens`);
      if (field.minLength && v.length < field.minLength) return fail(`minstens ${field.minLength} tekens`);
      if (field.enum && !field.enum.includes(v)) return fail(`kies uit ${field.enum.join(", ")}`);
      if (field.pattern && !field.pattern.test(v)) return fail("ongeldige waarde");
      return { ok: true, value: v };
    }
    case "integer": {
      const n = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n)) return fail("moet een geheel getal zijn");
      if (n < field.min || n > field.max) return fail(`tussen ${field.min} en ${field.max}`);
      return { ok: true, value: n };
    }
    case "boolean":
      if (typeof value !== "boolean") return fail("moet waar of onwaar zijn");
      return { ok: true, value };
    case "array": {
      if (!Array.isArray(value)) return fail("moet een lijst zijn");
      if (value.length > field.maxItems) return fail(`hooguit ${field.maxItems} items`);
      if (field.minItems && value.length < field.minItems) return fail(`minstens ${field.minItems} items`);
      const out: unknown[] = [];
      for (const [i, item] of value.entries()) {
        const r = check(field.items, item, `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return fail("moet een object zijn");
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(obj)) if (!(key in field.properties)) return fail(`onbekend veld "${key}"`);
      for (const [key, sub] of Object.entries(field.properties)) {
        if (obj[key] === undefined || obj[key] === null) {
          if (field.required?.includes(key)) return fail(`"${key}" ontbreekt`);
          continue;
        }
        const r = check(sub, obj[key], path ? `${path}.${key}` : key);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      return { ok: true, value: out };
    }
  }
}

export function validate<T = Record<string, unknown>>(schema: ObjectSchema, value: unknown): Result<T> {
  return check(schema, value ?? {}, "") as Result<T>;
}

/** The same schema as a Gemini function declaration (OpenAPI subset). */
export function toGemini(field: Field): Record<string, unknown> {
  const description = field.description ? { description: field.description } : {};
  switch (field.type) {
    case "string":
      return { type: "STRING", ...description, ...(field.enum ? { enum: [...field.enum] } : {}) };
    case "integer":
      return { type: "INTEGER", ...description };
    case "boolean":
      return { type: "BOOLEAN", ...description };
    case "array":
      return { type: "ARRAY", ...description, items: toGemini(field.items) };
    case "object":
      return { type: "OBJECT", ...description, properties: Object.fromEntries(Object.entries(field.properties).map(([k, v]) => [k, toGemini(v)])), ...(field.required?.length ? { required: [...field.required] } : {}) };
  }
}
