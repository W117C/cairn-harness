package mathutil

// RunCalc 跨文件调用 mathutil.go 的 Calc（同包免限定名——名字图按名连边）。
func RunCalc(a int, b int) int {
	return Calc(a, b)
}

// UnusedGo 零引用符号（zeroRefSymbols 登记）。
func UnusedGo() string {
	return "unused"
}
