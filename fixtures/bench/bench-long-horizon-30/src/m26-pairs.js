// 把数组两两配对，落单的丢掉
export function pairs(a) { const o=[]; for (let i=0;i<a.length;i+=2) o.push([a[i]]) ; return o }
