import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Space,
  Tag,
  Typography,
  App,
} from "antd";
import ArrowLeftOutlined from "@ant-design/icons/ArrowLeftOutlined";
import ArrowRightOutlined from "@ant-design/icons/ArrowRightOutlined";
import { Link, useNavigate } from "react-router-dom";
import { label } from "./api";
export function Status({ value }: { value: string }) {
  const color = ["FAILED", "FAIL_CLOSED"].includes(value)
    ? "error"
    : [
          "UNKNOWN",
          "STALE",
          "HUMAN_RECOVERY",
          "REVERIFY_REQUIRED",
          "SYNC_REQUIRED",
        ].includes(value)
      ? "warning"
      : ["PASSED", "SUCCEEDED", "CLOSED", "ACTIVE", "VALID", "READY"].includes(
            value,
          )
        ? "success"
        : "purple";
  return <Tag color={color}>{label(value)}</Tag>;
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
  back,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  back?: string;
}) {
  return (
    <header className="page-title">
      {back && (
        <Link className="back" to={back}>
          <ArrowLeftOutlined aria-hidden="true" /> 返回
        </Link>
      )}
      <div className="title-row">
        <div>
          <div className="eyebrow">{eyebrow || "AI NATIVE / DEVOPS"}</div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
export function Code({ value }: { value: any }) {
  return (
    <pre className="code">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
export function Blank({
  title,
  description,
  link,
  button,
}: {
  title: string;
  description?: string;
  link?: string;
  button?: string;
}) {
  return (
    <Card className="empty-card">
      <Empty
        description={
          <>
            <h3>{title}</h3>
            <p>{description}</p>
          </>
        }
      >
        {link && (
          <Link to={link}>
            <Button type="primary">
              {button || "开始"} <ArrowRightOutlined aria-hidden="true" />
            </Button>
          </Link>
        )}
      </Empty>
    </Card>
  );
}
export function JsonEditor({
  initial,
  onSave,
  title,
  description,
}: {
  initial: any;
  onSave: (value: any) => Promise<any>;
  title: string;
  description?: string;
}) {
  const [value, setValue] = useState(JSON.stringify(initial, null, 2));
  return (
    <ActionForm
      title={title}
      onSubmit={() => onSave(JSON.parse(value))}
      button="保存草稿"
    >
      <p className="muted">
        {description ||
          "草稿保存后需要人类签发才能生效。可由 agent 通过文件协议提交同样的结构。"}
      </p>
      <Input.TextArea
        aria-label={title}
        className="json-editor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoSize={{ minRows: 22, maxRows: 45 }}
        spellCheck={false}
      />
    </ActionForm>
  );
}
export function ActionForm({
  title,
  children,
  onSubmit,
  button = "保存",
  initialValues,
  onDone,
  disabled = false,
}: {
  title: string;
  children: React.ReactNode;
  onSubmit: (v: any) => Promise<any>;
  button?: string;
  initialValues?: any;
  onDone?: (v: any) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { message } = App.useApp();
  return (
    <Card title={title}>
      <Form
        layout="vertical"
        initialValues={initialValues}
        onFinish={async (v) => {
          setBusy(true);
          setError("");
          try {
            const r = await onSubmit(v);
            message.success("操作已记录");
            onDone?.(r);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        {error && (
          <Alert
            className="form-error"
            type="error"
            message="操作未完成"
            description={error}
            showIcon
          />
        )}
        <div className="form-footer">
          <Button
            htmlType="submit"
            type="primary"
            loading={busy}
            disabled={disabled}
          >
            {button}
          </Button>
        </div>
      </Form>
    </Card>
  );
}
export function Field({
  name,
  title,
  area = false,
  required = true,
  placeholder,
}: {
  name: string;
  title: string;
  area?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <Form.Item
      name={name}
      label={title}
      rules={required ? [{ required: true, message: "请填写" + title }] : []}
    >
      {area ? (
        <Input.TextArea rows={3} placeholder={placeholder} />
      ) : (
        <Input placeholder={placeholder} />
      )}
    </Form.Item>
  );
}
export function Detail({ items }: { items: [string, any][] }) {
  return (
    <dl className="detail">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
