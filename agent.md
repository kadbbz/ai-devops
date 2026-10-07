# 项目要求

## 技术

- 技术栈：TypeScript / Node / React
- 前端类库：AntDesign
- 数据库：MySQL
- 部署：单 Docker 

## 生命周期

1. 后端：先基于 spec 写 api 测试脚本，再编码实现，然后执行 api 测试，直到全绿
2. 前端：先编码实现，然后基于 prd 写 e2e 测试脚本，然后执行 e2e 测试，直到全绿
3. 更新 manual

## 文档

prd 和 spec 用 md 格式，manul 用 html

- prd： /doc/prd
- spec： /doc/spec
- 测试用例和测试脚本： /doc/test_case
- 使用手册： /doc/manual

## 其他要求

- 确保代码和文档一致
- 使用中文注释，中文文档
- UI 设计风格要现代化
    - 优先采用卡片，而非表格
    - 优先弹出新页面，而非弹窗
    - 紫色风格