# 厂商制品目录

`/repository/metadata` 是业务领取单，列出 Maven 坐标、必需和可选 classifier/extension 组合。真正的版本元数据在标准目录下的 maven-metadata.xml，按 snapshotVersions 中各分类的 value 解析具体版本；该 value 不必全部相同，不能自行把分类文件强行替换成主文件版本。

当前本地数据提供主件与 schema 同一次构建，不提供可选 notes。业务交付要求必需资料属于同一次构建 cohort；若元数据描述不同构建，保留不齐状态而非混装。文件名由 artifactId、具体版本、可选 classifier 和 extension 组成。未声明的 classifier 不授权遍历。

每个已发布必需文件的地址后加 `.sha256` 可领取原始内容的 SHA256 文本校验值；校验文件与文件来自同一具体构建。

generation=2 发布新快照，mode=publishing 使 schema 文件暂未完成发布并返回 503；404 只说明此次具体地址不存在，不能推断 SNAPSHOT 今后永远没有该资料。

## 本地演练控制

`GET /_health` 返回服务健康状态；`GET /_audit` 仅返回请求路径、方法和体积，不记录凭据。`POST /_control` 接收 JSON，可调整 generation、mode、clock。控制端点只服务于本地演练，不是资料接口，也不是浏览器业务操作入口。每次重新启动服务都会恢复初始数据；生产接入时不部署此控制面。
