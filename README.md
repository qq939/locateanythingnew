# LocateAnything 视频标注工作台

本项目运行在本地 `8082`，目标是围绕视频标注工作流：上传视频、逐帧查看、运行 LocateAnything、把模型输出落成可编辑标注，并在网页上持续展示当前帧和全部帧的标注结果。

## 功能

- 本地视频预览与逐帧跳转
- 当前帧框选、点选、删除、清空
- 运行 LocateAnything 到当前帧
- 运行 LocateAnything 到所有帧或指定帧段，支持帧间隔抽帧和停止
- 调用 `locateanything_worker.py` 支持的任务：
  - `detect`
  - `ground_single`
  - `ground_multi`
  - `ground_text`
  - `detect_text`
  - `ground_gui`
  - `point`
- 当前帧结果列表和全局时间线结果列表
- 保存到 `data/annotations.json`
- 下载标注 JSON
- `/api/model-status` 展示 Python 依赖与模型环境状态
- `/api/prepare-model` 启动模型下载任务，网页显示下载进度条
- `/api/model-progress` 返回模型下载阶段、百分比、当前文件和文件数

## 启动

```bash
./user_start.sh
```

启动脚本会创建项目内 `.venv`，并安装：

```bash
pip install -r requirements.txt
```

打开：

```text
http://localhost:8082
```

健康检查：

```bash
curl http://localhost:8082/health
curl http://localhost:8082/api/model-status
curl http://localhost:8082/api/model-progress
```

## LocateAnything 接入

本项目包含 NVlabs/Eagle `Embodied/locateanything_worker.py` 的 worker API，并通过 `locateanything_service.py` 包装成 Node 可调用的常驻 Python 子进程。

网页运行 LocateAnything 时会：

1. 把当前 canvas 帧导出为 JPEG base64。
2. `POST /api/locate`。
3. Node 将请求转发给 Python worker。
4. Python 调用 `LocateAnythingWorker("nvidia/LocateAnything-3B")`。
5. 解析 `<box><x1><y1><x2><y2></box>` 和 `<box><x><y></box>`。
6. 前端把 boxes/points 写入当前帧标注并刷新结果列表。

批量标注会在浏览器内逐帧 seek 视频并把每一帧截图发送到 `/api/locate`。默认起始帧为 `0`，结束帧为视频最后一帧，帧间隔为 `1`，也就是逐帧跑完整视频；长视频可以提高帧间隔做抽帧。

首次真实推理会下载并加载 `nvidia/LocateAnything-3B`，耗时取决于网络、磁盘和设备。开发调试可临时设置：

```bash
LOCATEANYTHING_MOCK=1 ./user_start.sh
```

最终部署默认不启用 mock。

## 模型下载进度

点击网页左侧的“准备 / 下载模型”会调用：

```bash
POST /api/prepare-model
```

后端会启动 `locateanything_model_prepare.py`，用 Hugging Face Hub 枚举模型文件并逐个下载，同时把进度写到 `data/model_progress.json`。前端每 1.5 秒轮询：

```bash
GET /api/model-progress
```

页面会展示下载阶段、百分比、当前文件、已完成文件数和总文件数。下载完成后进度为 `100%`；首次推理仍需要把模型权重加载到内存。
