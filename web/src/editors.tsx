import { useState } from "react";
import { Button, Form, Input, Select, Space, Divider, Card } from "antd";
import { ActionForm, JsonEditor } from "./components";
function Lines({
  value = [],
  onChange,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
}) {
  return (
    <Input.TextArea
      rows={3}
      value={value.join("\n")}
      onChange={(e) => onChange?.(e.target.value.split("\n"))}
    />
  );
}
const clean = (v: any): any =>
  Array.isArray(v)
    ? v.map(clean).filter((x) => typeof x !== "string" || x.trim())
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]))
      : typeof v === "string"
        ? v.trim()
        : v;
function Item({
  name,
  title,
  list = false,
  area = false,
}: {
  name: any;
  title: string;
  list?: boolean;
  area?: boolean;
}) {
  return (
    <Form.Item
      name={name}
      label={title}
      rules={[{ required: true, message: "请填写" + title }]}
      extra={list ? "每行一项" : undefined}
    >
      {list ? <Lines /> : area ? <Input.TextArea rows={3} /> : <Input />}
    </Form.Item>
  );
}
export function PlanEditor({
  initial,
  onSave,
}: {
  initial: any;
  onSave: (v: any) => Promise<any>;
}) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <Button className="section-gap" onClick={() => setAdvanced(!advanced)}>
        {advanced ? "返回表单编辑" : "结构化导入"}
      </Button>
      {advanced ? (
        <JsonEditor title="方案草稿" initial={initial} onSave={onSave} />
      ) : (
        <ActionForm
          title="点方案与应用方案"
          initialValues={initial}
          button="保存草稿"
          onSubmit={(v) => onSave(clean(v))}
        >
          <h3>目标与边界</h3>
          <Item name={["point", "goal"]} title="预期目标" area />
          <div className="form-grid">
            <Item name={["point", "scope"]} title="允许范围" list />
            <Item name={["point", "nonGoals"]} title="非目标" list />
            <Item name={["point", "risks"]} title="风险与影响" list />
            <Item name={["point", "owner"]} title="责任人" />
          </div>
          <Form.List name={["point", "references"]}>
            {(fields, { add, remove }) => (
              <>
                <h3>参考与采纳</h3>
                {fields.map((f) => (
                  <Card key={f.key} className="section-gap" size="small">
                    <Item name={[f.name, "source"]} title="来源" />
                    <Item name={[f.name, "scope"]} title="适用范围" />
                    <Item name={[f.name, "content"]} title="建议内容" />
                    <Form.Item name={[f.name, "adoption"]} label="采纳状态">
                      <Select
                        options={[
                          { value: "proposed", label: "待评估" },
                          { value: "accepted", label: "采纳" },
                          { value: "rejected", label: "不采纳" },
                        ]}
                      />
                    </Form.Item>
                    <Button onClick={() => remove(f.name)}>删除参考</Button>
                  </Card>
                ))}
                <Button
                  onClick={() =>
                    add({
                      source: "",
                      scope: "",
                      content: "",
                      adoption: "proposed",
                    })
                  }
                >
                  添加参考
                </Button>
              </>
            )}
          </Form.List>
          <Divider />
          <h3>状态改变与恢复</h3>
          <Form.List name={["application", "changes"]}>
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <div className="change-row" key={f.key}>
                    <Item name={[f.name, "object"]} title="改变对象" />
                    <Form.Item
                      name={[f.name, "operation"]}
                      label="操作类型"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          ["read", "只读 / 纯代码"],
                          ["write", "写入"],
                          ["update", "更新"],
                          ["delete", "删除"],
                          ["migrate", "迁移"],
                          ["configure", "配置"],
                          ["permission", "权限"],
                        ].map(([value, label]) => ({ value, label }))}
                      />
                    </Form.Item>
                    <Item name={[f.name, "scope"]} title="影响范围" />
                    <Button onClick={() => remove(f.name)}>移除</Button>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    add({ object: "", operation: "read", scope: "" })
                  }
                >
                  添加改变对象
                </Button>
              </>
            )}
          </Form.List>
          <div className="form-grid section-gap">
            {[
              ["preconditions", "前置条件"],
              ["invariants", "必须保持的不变量"],
              ["acceptance", "可观察验收标准"],
              ["documentation", "文档要求"],
              ["apiCases", "API 验收场景"],
              ["e2eCases", "E2E 用户路径"],
              ["permissions", "执行身份与权限"],
              ["idePaths", "IDE 允许修改路径"],
            ].map(([key, title]) => (
              <Item key={key} name={["application", key]} title={title} list />
            ))}
          </div>
          <div className="form-grid">
            {[
              ["idempotency", "幂等策略"],
              ["transaction", "事务边界"],
              ["rollback", "恢复方式"],
              ["migration", "迁移说明"],
            ].map(([key, title]) => (
              <Item key={key} name={["application", key]} title={title} area />
            ))}
          </div>
          <Divider />
          <h3>上下文与约束</h3>
          <Form.Item name={["context", "dataClass"]} label="数据分级">
            <Select
              options={[
                { value: "public", label: "公开" },
                { value: "internal", label: "内部" },
                { value: "restricted", label: "受限 · 禁止发送模型" },
              ]}
            />
          </Form.Item>
          <Item name={["context", "forbidden"]} title="禁止操作" list />
          <Form.Item
            name={["context", "hotfixRefs"]}
            label="已发布热修复引用（每行一个 ID）"
          >
            <Lines />
          </Form.Item>
          <Form.List name={["context", "entries"]}>
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <div className="form-grid" key={f.key}>
                    <Item name={[f.name, "path"]} title="上下文文件路径" />
                    <Item name={[f.name, "digest"]} title="文件 SHA-256 摘要" />
                    <Button onClick={() => remove(f.name)}>移除上下文</Button>
                  </div>
                ))}
                <Button onClick={() => add({ path: "", digest: "sha256:" })}>
                  添加固定上下文
                </Button>
              </>
            )}
          </Form.List>
        </ActionForm>
      )}
    </>
  );
}
export function MaterialsEditor({
  initial,
  onSave,
}: {
  initial: any;
  onSave: (v: any) => Promise<any>;
}) {
  return (
    <ActionForm
      title="交付材料"
      initialValues={initial}
      button="保存材料并更新分支"
      onSubmit={(v) => onSave(clean(v))}
    >
      {[
        ["manual", "使用说明"],
        ["changelog", "变更说明"],
        ["apiContract", "接口契约"],
      ].map(([key, title]) => (
        <Item key={key} name={key} title={title} area />
      ))}
      <div className="form-grid">
        <Item name="apiCases" title="API 验收场景" list />
        <Item name="e2eCases" title="E2E 用户路径" list />
        <Item name="dataPreparation" title="测试数据准备" area />
        <Item name="dataCleanup" title="测试数据清理" area />
      </div>
      <Item name="dataDigest" title="固定测试数据 SHA-256 摘要" />
      <Item name="deviations" title="实际行为与方案的偏离" area />
    </ActionForm>
  );
}
export function SystemEditorForm({
  initial,
  onSave,
}: {
  initial: any;
  onSave: (v: any) => Promise<any>;
}) {
  return (
    <ActionForm
      title="系统方案"
      initialValues={initial}
      button="保存系统方案"
      onSubmit={(v) => onSave(clean(v))}
    >
      <div className="form-grid">
        {[
          ["sourceSha", "最终组合提交"],
          ["artifactDigest", "唯一制品摘要"],
          ["environment", "发布环境"],
          ["configVersion", "配置版本"],
        ].map(([k, t]) => (
          <Item key={k} name={k} title={t} />
        ))}
      </div>
      {[
        ["applications", "完整应用方案 ID"],
        ["scope", "完整发布范围"],
        ["sequence", "发布顺序"],
        ["migrations", "迁移步骤"],
        ["healthChecks", "健康检查"],
      ].map(([k, t]) => (
        <Item key={k} name={k} title={t} list />
      ))}
      <Item name="rollback" title="回滚或前向修复步骤" area />
    </ActionForm>
  );
}
