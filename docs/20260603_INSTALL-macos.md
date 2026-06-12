# 安装说明（macOS）

> 适用范围：**Apple Silicon（M 系列）Mac**，macOS 11 (Big Sur) 及以上。Intel Mac 暂不支持。

## 安装步骤

1. 下载 `Spark_x.x.x_aarch64.dmg`。
2. 双击打开 DMG，把 **Spark** 拖进「应用程序」文件夹。

## 首次打开（重要）

本应用目前使用**临时签名**（未经 Apple 付费公证），所以 macOS 首次打开会拦截，提示「无法打开，因为 Apple 无法检查其是否包含恶意软件」。这是正常现象，按下面任一方式打开即可：

**方式一（推荐）：右键打开**
1. 在「应用程序」里找到 Spark。
2. **右键点击** → 选择「打开」。
3. 在弹窗里再次点「打开」。
4. 之后就能正常双击启动了。

**方式二：命令行解除隔离标记**

如果方式一仍被拦，打开「终端」执行：

```bash
xattr -cr /Applications/Spark.app
```

然后正常双击打开。

## 验证下载完整性（可选但推荐）

为确认下载的 DMG 未被篡改，可校验 SHA-256：

```bash
shasum -a 256 ~/Downloads/Spark_x.x.x_aarch64.dmg
```

输出应与 release 页面附带的 `.sha256` 文件内容一致。

## 配置 API Key

首次启动后，在应用内「设置」面板填入你自己的 API Key：

- **MinerU Token**（必填，用于 PDF 解析）— https://mineru.net/apiManage/token
- **LLM Key**（必填，默认 DeepSeek）— https://platform.deepseek.com/api_keys
- **Embedding Key**（可选，可关闭）— https://cloud.siliconflow.cn/account/ak

所有密钥**只保存在你本机**，仅在本地后端使用，不会上传到任何服务器，也不会打包进应用本身。

## 卸载

把「应用程序」里的 Spark 拖到废纸篓即可。本地数据（书库、解析缓存、设置）位于：

```
~/Library/Application Support/com.anbc.focused-reading/
```

如需彻底清除，一并删除该目录。
