// **每一条**都去掉首尾空白
export function trimAll(xs) { return [xs[0].trim(), ...xs.slice(1)] }
