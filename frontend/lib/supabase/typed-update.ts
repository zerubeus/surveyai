/**
 * Type-safe wrapper for supabase .update() calls.
 * 
 * supabase-js TypeScript inference sometimes fails to resolve update payload types,
 * returning 'never'. This utility casts the payload to 'any' to bypass the inference
 * issue while keeping the runtime behavior correct.
 * 
 * Usage:
 *   await supabase.from("projects").update(typedUpdate({ name: "new" })).eq("id", id)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function typedUpdate<T extends Record<string, unknown>>(payload: T): any {
  return payload;
}
