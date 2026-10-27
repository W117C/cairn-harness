/** Build a regex literal for the mutation table without presenting the needle
 * itself as a regular-expression argument to static analysis. */
export function regexSource(body, flags = "") {
  return "/" + body + "/" + flags;
}
