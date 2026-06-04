# LocateAnything New

一个简单的视频标注页面，运行在本地 8082。

## 功能

- 上传本地视频并逐帧预览
- 上一帧 / 下一帧 / 跳转帧
- 框选、点选、删除选中、清空本帧
- Locate 当前帧 demo 接口
- 保存标注到 `data/annotations.json`
- 下载标注 JSON

## 启动

```bash
./user_start.sh
```

打开：

```text
http://localhost:8082
```

健康检查：

```bash
curl http://localhost:8082/health
```

## 说明

`/api/locate` 当前返回一个 demo bbox，用来把页面和标注流程跑通。后续接入真实 LocateAnything 时，只需要替换 `server.js` 里的 `demoLocate()` 或接到 Python worker。
