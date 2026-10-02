import { useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography
} from 'antd'
import { api, states, useSession, uploadEvidence, type Row } from './api'
export function Status({ value, stale }: { value: string; stale?: boolean }) {
  return (
    <Space>
      <Tag
        color={
          ['failed', 'expired'].includes(value)
            ? 'red'
            : ['passed', 'verified', 'reviewed', 'completed'].includes(value)
              ? 'green'
              : ['queued', 'running', 'pending_human', 'awaiting_evidence'].includes(value)
                ? 'orange'
                : 'default'
        }
      >
        {states[value] || value}
      </Tag>
      {stale && <Tag color="orange">证据已过期</Tag>}
    </Space>
  )
}
export type Field = {
  name: string
  label: string
  kind?: 'area' | 'number' | 'password' | 'lines'
  options?: string[] | { label: string; value: string }[]
  required?: boolean
}
export function Action({
  label,
  url,
  method = 'POST',
  fields = [],
  initial = {},
  confirm = false,
  target = '',
  environment = '',
  version = '',
  recovery = '撤销草稿或提交新的修订',
  disabled,
  after,
  transform,
  primary
}: {
  label: string
  url: string
  method?: string
  fields?: Field[]
  initial?: Row
  confirm?: boolean
  target?: string
  environment?: string
  version?: string
  recovery?: string
  disabled?: boolean
  after?: (result: any) => void
  transform?: (values: Row) => Row
  primary?: boolean
}) {
  const { user, refresh } = useSession()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form] = Form.useForm()
  const submit = async () => {
    try {
      const values = await form.validateFields()
      setBusy(true)
      setError('')
      const data = { ...initial, ...values }
      for (const f of fields)
        if (f.kind === 'lines' && typeof data[f.name] === 'string')
          data[f.name] = data[f.name]
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean)
      const result = await api(url, method, {
        ...(transform ? transform(data) : data),
        ...(confirm ? { confirmed: true } : {})
      })
      await refresh()
      after?.(result)
      setOpen(false)
    } catch (e: any) {
      if (e.message) setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        type={primary ? 'primary' : 'default'}
        disabled={disabled}
        onClick={() => {
          setError('')
          form.resetFields()
          setOpen(true)
        }}
      >
        {label}
      </Button>
      <Modal
        title={label}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText={confirm ? '确认执行' : '保存'}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Descriptions column={1} size="small">
          <Descriptions.Item label="对象">
            {target || url.split('/').filter(Boolean).at(-2)}
          </Descriptions.Item>
          {version && <Descriptions.Item label="版本">{version}</Descriptions.Item>}
          {environment && <Descriptions.Item label="环境">{environment}</Descriptions.Item>}
          <Descriptions.Item label="执行人">{user.displayName}</Descriptions.Item>
          {confirm && <Descriptions.Item label="恢复方式">{recovery}</Descriptions.Item>}
        </Descriptions>
        {error && <Alert message={error} type="error" showIcon style={{ marginBlock: 12 }} />}
        <Form
          layout="vertical"
          form={form}
          initialValues={Object.fromEntries(
            Object.entries(initial).map(([k, v]) => [k, Array.isArray(v) ? v.join('\n') : v])
          )}
        >
          {fields.map((f) => (
            <Form.Item
              key={f.name}
              name={f.name}
              label={f.label}
              rules={[{ required: f.required !== false }]}
            >
              {f.options ? (
                <Select
                  options={f.options.map((o) =>
                    typeof o === 'string' ? { label: states[o] || o, value: o } : o
                  )}
                />
              ) : f.kind === 'number' ? (
                <InputNumber min={0} style={{ width: '100%' }} />
              ) : f.kind === 'password' ? (
                <Input.Password />
              ) : ['area', 'lines'].includes(f.kind || '') ? (
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
              ) : (
                <Input />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </>
  )
}
export function Details({ value, title = '记录详情' }: { value: any; title?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="small" type="link" onClick={() => setOpen(true)}>
        详情
      </Button>
      <Modal open={open} title={title} onCancel={() => setOpen(false)} footer={null} width={760}>
        <Typography.Paragraph>
          <pre className="record-json">{JSON.stringify(value, null, 2)}</pre>
        </Typography.Paragraph>
      </Modal>
    </>
  )
}
export function FileLink({ id, label = '下载证据' }: { id?: string; label?: string }) {
  return id ? (
    <a href={`/api/files/${id}`}>{label}</a>
  ) : (
    <Typography.Text type="secondary">证据缺失</Typography.Text>
  )
}
export function EvidenceUpload({ changeId, disabled }: { changeId: string; disabled: boolean }) {
  const { refresh } = useSession()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <span>
      <label className="file-upload">
        <span>{busy ? '上传中…' : '选择报告附件'}</span>
        <input
          aria-label="选择报告附件"
          type="file"
          disabled={disabled || busy}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            setBusy(true)
            setError('')
            try {
              await uploadEvidence(changeId, file)
              await refresh()
            } catch (e: any) {
              setError(e.message)
            } finally {
              setBusy(false)
              event.target.value = ''
            }
          }}
        />
      </label>
      {error && <Alert type="error" message={error} />}
    </span>
  )
}
