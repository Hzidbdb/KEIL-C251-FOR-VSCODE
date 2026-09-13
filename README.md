# Keil Assistant C251

## 简述 📑

VS Code 上的 Keil C251 辅助工具，与 C/C++ 插件配合使用。

能够为 Keil 项目提供 **语法高亮**、**代码片段** 的功能，并支持对 Keil 项目进行 **编译**、**下载**。

- 仅支持 Keil uVision 5 及以上版本
- 仅支持 Windows 平台

## 功能特性 🎉

- 加载 Keil C251 项目，并以 Keil 项目资源管理器的展示方式显示项目视图（Project → Target → Group → 源文件）
- 自动监视 Keil 项目文件的变化，及时更新项目视图
- 通过调用 Keil 命令行接口实现 编译、重新编译、下载 Keil 项目
- 构建日志实时输出到 `Keil C251` 输出面板，并将编译错误 / 警告同步到「问题」面板
- 自动生成 c_cpp_properties.json 文件，使 C/C++ 插件的语法分析能正常进行
- 源文件项可展开其 `#include` 引用（限制嵌套层级，避免循环包含）
- 为 `.a251` / `.a51` 汇编源文件提供 语法高亮、代码片段

## 用法 📖

### 准备工作

1. 安装 C/C++ 插件
2. 进入 Keil Assistant C251 插件设置，设置好 Keil 可执行文件 `UV4.exe` 的绝对路径（`KeilAssistant.C251.Uv4Path`）

> 未配置时，插件会在 `C:\Keil_v5\UV4\UV4.exe`、`C:\Keil_v5\UV4.exe`、`C:\Keil\UV4\UV4.exe` 等常见路径下自动探测。

### 开始使用 🏃‍♀️

1. 在 Keil 上创建好项目，添加好文件，头文件路径等
2. 点击 **打开项目** 图标，或者使用 VS Code 直接打开 Keil 项目文件（`.uvproj` / `.uvprojx`）所在的目录，插件会自动加载 Keil 项目

### 常用操作

**编译，下载，重新编译**：目标（Target）行上提供了 3 个按钮，分别代表 编译、下载、重新编译

| 操作 | Keil 命令 | 默认快捷键 |
| --- | --- | --- |
| 编译 | `UV4 -b` | `F7` |
| 重新编译 | `UV4 -r` | `Ctrl+Alt+F7` |
| 下载 | `UV4 -f` | `Ctrl+Alt+D` |

**保存和刷新**：在 Keil 上添加 / 删除源文件、更改配置，更改完毕后点击 **保存所有**，插件检测到 Keil 项目变化后会自动刷新项目视图

**打开源文件**：单击源文件将以预览模式打开，双击源文件将切换到非预览模式打开

**切换 Keil Target**：点击项目上的切换按钮（或执行命令 `Keil C251: Select Target`），可以在多个 Keil Target 之间切换，当前 Target 会标记为 `(active)`

**展开引用**：点击源文件项的箭头图标，可以展开该文件 `#include` 的引用文件（嵌套深度上限 12 层）

**查看构建日志**：编译 / 下载过程中，`Keil C251` 输出面板会实时打印 Keil 构建日志，结束后给出错误数与警告数

**切换 C/C++ 配置**：每个 Target 会生成一份独立的 C/C++ 配置（名称为 `C251: <Target>`，包含该 Target 的头文件路径与宏定义），可在 C/C++ 插件的状态栏中切换

### 其他设置

工作区设置：项目排除列表（`KeilAssistant.Project.ExcludeList`）

当某个目录下存在多个 Keil 项目时，使用插件打开该目录，插件会加载所有的 Keil 项目，通过此选项，可以指定需要排除哪些 Keil 项目，防止在打开该工作区时自动加载该项目。

默认的排除列表：

```json
[
    "template.uvproj",
    "template.uvprojx"
]
```

此外，插件在自动发现项目时会跳过 `Example` / `examples` / `template` / `templates` 目录，以及 `.git`、`node_modules`、`out_file` 目录；确实需要加载这些项目时，用 **Keil C251: Open Project** 手动打开即可。
