# 粉色配色（生产容器正在用的值）

来源：`/app/runtime/client/assets/index-BUsbfIlC.css` 的 `:root` 与 `.dark` 块。

核心思想：**所有中性色都从 `--primary` 混出来**，所以改一个 hue 就能整体换色。
当前 `--primary` 的 hue = **300**（品红/粉）。默认版是紫色系（hue 300 但更高明度、更低饱和）。

## 浅色（:root）

```
--primary:              oklch(57% .14 300)
--primary-foreground:   oklch(99% 0 0)
--ring:                 oklch(57% .14 300)
--accent:               oklch(94% .03 300)
--accent-foreground:    oklch(35% .07 300)
--foreground:           oklch(20% 0 0)
--card-foreground:      oklch(20% 0 0)
--popover-foreground:   oklch(20% 0 0)
--secondary-foreground: oklch(25% 0 0)
--muted-foreground:     oklch(50% 0 0)
--destructive:          oklch(60% .22 27)
--success:              oklch(70% .15 160)
--warning:              oklch(78% .16 80)

--background:  color-mix(in oklab, var(--primary) 3%,  oklch(100% 0 0))
--card:        color-mix(in oklab, var(--primary) 1%,  oklch(100% 0 0))
--popover:     color-mix(in oklab, var(--primary) 1%,  oklch(100% 0 0))
--secondary:   color-mix(in oklab, var(--primary) 4%,  oklch(97% 0 0))
--muted:       color-mix(in oklab, var(--primary) 4%,  oklch(97% 0 0))
--border:      color-mix(in oklab, var(--primary) 12%, oklch(92% 0 0))
--input:       color-mix(in oklab, var(--primary) 12%, oklch(92% 0 0))
```

## 深色（.dark）

```
--primary:              oklch(78% .115 300)
--primary-foreground:   oklch(15% 0 0)
--accent:               oklch(28% .05 300)
--accent-foreground:    oklch(85% .1 300)
--foreground:           oklch(96% 0 0)
--popover-foreground:   oklch(96% 0 0)
--muted-foreground:     oklch(68% 0 0)
--destructive:          oklch(62% .2 27)
--success:              oklch(72% .15 160)
--warning:              oklch(80% .16 80)
```

## 日志级别色（两套模式各一组）

```
浅色：--log-info oklch(50% .155 230) / --log-success oklch(50% .15 160)
      --log-warn oklch(52% .16 80)  / --log-error   oklch(55% .22 27)
深色：--log-info oklch(75% .14 230) / --log-success oklch(72% .15 160)
      --log-warn oklch(80% .16 80)  / --log-error   oklch(62% .2 27)
```

## 如何重新应用

这些值本来就在生产容器的 `index-BUsbfIlC.css` 里（构建产物）。
若要从源码重建，需要在 WebUI 源码的全局样式里改同样的令牌，然后重新构建。
仅改容器里的 CSS 会在镜像更新时丢失。
