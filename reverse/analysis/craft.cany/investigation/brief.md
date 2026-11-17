# Brief

**Question:** 追踪已下载原版Windows游戏HLF10631030.exe.mengoo的入口、程序集初始化、护理任务及评分数据路径。

**Purpose:** 为按原版逐功能逐模型复刻取得本地客户端依据。

**Targets:**
- /Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/HLF10631030.exe.mengoo
- /Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll
- /Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/HLF10631030_Data

**Constraints:**
- 仅静态读取原版，不运行Windows EXE，不解密，不绕过认证，不读写凭据
- 成果与工具放外置固态硬盘，保留已有重建源码
- 应用默认小窗，编译CPU低于单核80%，运行总内存低于2GB

**Done when:** 入口与可读平台调用具有地址或CIL位置；与既有Windows业务证据对应；准确记录加密业务与自定义资源缺项。
