import { api } from "./api.js";

export function orderCount(id) {
  return api.listOrders(id).length
}
export function orderOwner(id) {
  return api.getUser(id).name
}
