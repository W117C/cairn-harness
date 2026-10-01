import { api } from "./api.js";

export function cartOwner(id) {
  return api.getUser(id).name
}
