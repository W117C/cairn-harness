package mathutil

// Clamp 把 v 夹回 [lo, hi]；同文件被 Calc 调用（boundary 登记行）。
func Clamp(v int, lo int, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// Calc 同包内被 calc.go 的 RunCalc 调用（跨文件真边）。
func Calc(a int, b int) int {
	return Clamp(a+b, 0, 100)
}
