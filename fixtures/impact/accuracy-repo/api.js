export function handleRequest(req) {
  const path = slugify(req.url || "/");
  logInfo("request " + path);
  return createUser(path);
}
