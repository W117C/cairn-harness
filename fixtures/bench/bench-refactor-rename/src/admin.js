import { api } from "./api.js";

export function adminLookup(id) {
  return api.getUser(id)
}
