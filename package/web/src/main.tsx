import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Form,
  Input,
  Layout,
  Menu,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd'
import { api, roles, Session, setCsrf, type Row } from './api'
import { Action, Details } from './components'
import { ProjectWorkspace, AuditView } from './views'
import 'antd/dist/reset.css'
import './style.css'
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } }
})
function Login({ refresh }: { refresh: () => Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <main className="login-page">
      <Card className="login-card">
        <Tag color="cyan">AI DevOps · P0</Tag>
        <Typography.Title level={2}>登录交付工作台</Typography.Title>
        <Typography.Paragraph type="secondary">
          让需求、代码、验证与发布证据连成一条可追溯的交付记录。
        </Typography.Paragraph>
        {error && <Alert type="error" message={error} showIcon />}
        <Form
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true)
            try {
              const data = await api('/api/auth/login', 'POST', values)
              setCsrf(data.csrf)
              await refresh()
            } catch (e: any) {
              setError(e.message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Form.Item name="username" label="账号" rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button htmlType="submit" type="primary" loading={busy} block>
            登录
          </Button>
        </Form>
      </Card>
    </main>
  )
}
function Projects({ user }: { user: Row }) {
  const data = useQuery({ queryKey: ['projects'], queryFn: () => api('/api/projects') })
  const navigate = useNavigate()
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api('/api/users'),
    enabled: user.platformRole === 'platform_admin'
  })
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Text className="eyebrow">WORKSPACE</Typography.Text>
          <Typography.Title level={2}>项目与我的待办</Typography.Title>
          <Typography.Paragraph type="secondary">
            选择项目，查看变更、环境与尚未完成的证据。
          </Typography.Paragraph>
        </div>
        {user.platformRole === 'platform_admin' && (
          <Action
            primary
            label="创建项目"
            url="/api/projects"
            initial={{ template: 'phoenix-resource' }}
            fields={[
              { name: 'name', label: '项目名称' },
              { name: 'code', label: '项目代码' },
              {
                name: 'ownerUserId',
                label: '项目负责人',
                options: (users.data?.items || [])
                  .filter((u: Row) => !u.platformRole && u.status === 'active')
                  .map((u: Row) => ({ value: u.id, label: u.displayName }))
              },
              { name: 'application', label: '应用', required: false },
              { name: 'customer', label: '客户', required: false },
              { name: 'businessDomain', label: '业务域', required: false }
            ]}
            after={(p) => navigate(`/projects/${p.id}/overview`)}
          />
        )}
      </div>
      {data.error && <Alert type="error" message={data.error.message} />}
      <Card>
        <Table<Row>
          loading={data.isLoading}
          rowKey="id"
          dataSource={data.data?.items || []}
          scroll={{ x: 680 }}
          columns={[
            {
              title: '项目',
              dataIndex: 'name',
              render: (name, p) => (
                <Link to={`/projects/${p.id}/overview`}>
                  {name}
                  <div className="muted">{p.code}</div>
                </Link>
              )
            },
            { title: '负责人', dataIndex: 'ownerUserId' },
            { title: '模板', render: (_, p) => `${p.template} ${p.templateVersion}` },
            {
              title: '环境',
              render: (_, p) =>
                p.environments.map((e: Row) => (
                  <Tag key={e.id}>
                    {e.code} · {e.currentRevision ? e.currentRevision.slice(0, 8) : '未发布'}
                  </Tag>
                ))
            }
          ]}
        />
      </Card>
    </>
  )
}
function Platform({ user }: { user: Row }) {
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/api/users') })
  return (
    <>
      <Typography.Title level={2}>平台设置</Typography.Title>
      {user.platformRole === 'platform_admin' && (
        <Action
          label="创建用户"
          url="/api/users"
          fields={[
            { name: 'username', label: '账号' },
            { name: 'displayName', label: '显示名称' },
            { name: 'password', label: '初始密码（至少 12 位）', kind: 'password' }
          ]}
        />
      )}
      <Card className="section-card">
        <Table<Row>
          rowKey="id"
          dataSource={users.data?.items || []}
          scroll={{ x: 650 }}
          columns={[
            { title: '账号', dataIndex: 'username' },
            { title: '用户', dataIndex: 'displayName' },
            { title: '平台角色', render: (_, u) => roles[u.platformRole] || '业务用户' },
            { title: '状态', dataIndex: 'status' },
            {
              title: '操作',
              render: (_, u) =>
                user.platformRole === 'platform_admin' ? (
                  <Action
                    label="调整角色"
                    url={`/api/users/${u.id}`}
                    method="PUT"
                    confirm
                    target={u.displayName}
                    recovery="由平台管理员重新授予角色；现有会话将失效"
                    fields={[
                      {
                        name: 'platformRole',
                        label: '平台角色',
                        options: Object.entries(roles)
                          .filter(([k]) => k.startsWith('platform'))
                          .map(([value, label]) => ({ value, label }))
                      },
                      { name: 'reason', label: '变更原因' }
                    ]}
                  />
                ) : (
                  <Details value={u} />
                )
            }
          ]}
        />
      </Card>
      {user.platformRole === 'platform_security_admin' && (
        <Card title="项目安全策略" className="section-card">
          <Typography.Paragraph>
            通过项目 ID 配置出站预算与环境安全否决。安全管理员只能看到安全元数据。
          </Typography.Paragraph>
          <SecurityControls />
        </Card>
      )}
    </>
  )
}
function SecurityControls() {
  const [id, setId] = useState('')
  return (
    <Space direction="vertical">
      <Input aria-label="项目 ID" placeholder="项目 ID" value={id} onChange={(e) => setId(e.target.value)} />
      <Action
        disabled={!id}
        label="设置 AI 出站策略"
        url={`/api/projects/${id}/policy`}
        method="PUT"
        confirm
        target={id}
        initial={{
          allowedProviders: ['configured'],
          allowedFileTypes: ['json', 'md'],
          maxContextBytes: 64000,
          maxOutputTokens: 2000,
          budgetUsd: 10,
          maxRunCostUsd: 1
        }}
        fields={[
          { name: 'allowedProviders', label: '允许的提供方（每行一个）', kind: 'lines' },
          { name: 'allowedFileTypes', label: '允许文件类型（每行一个）', kind: 'lines' },
          { name: 'budgetUsd', label: '预算上限 USD', kind: 'number' },
          { name: 'maxRunCostUsd', label: '单次预留费用 USD', kind: 'number' }
        ]}
      />
      <Action
        disabled={!id}
        label="否决生产发布"
        url={`/api/projects/${id}/environments/prod`}
        method="PUT"
        confirm
        target={id}
        environment="prod"
        initial={{ safetyBlocked: true }}
        fields={[{ name: 'reason', label: '否决原因' }]}
      />
    </Space>
  )
}
function App() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const data = await api('/api/me')
      setCsrf(data.csrf)
      return data
    }
  })
  const refresh = async () => {
    await queryClient.invalidateQueries()
  }
  if (me.isLoading)
    return (
      <div className="loading">
        <Spin />
      </div>
    )
  if (!me.data) return <Login refresh={refresh} />
  const user = me.data.user
  if (user.mustChangePassword)
    return (
      <Session.Provider value={{ user, refresh }}>
        <main className="login-page">
          <Card title="首次登录请修改密码">
            <Action
              label="设置新密码"
              url="/api/auth/password"
              fields={[
                { name: 'currentPassword', label: '当前密码', kind: 'password' },
                { name: 'password', label: '新密码（至少 12 位）', kind: 'password' }
              ]}
            />
          </Card>
        </main>
      </Session.Provider>
    )
  return (
    <Session.Provider value={{ user, refresh }}>
      <Layout className="app-shell">
        <Layout.Header className="topbar">
          <Link className="brand" to="/">
            <span className="brand-mark">A</span>
            <strong>AI DevOps</strong>
          </Link>
          <Space wrap>
            <Link to="/">项目</Link>
            {user.platformRole && <Link to="/platform">平台设置</Link>}
            {user.platformRole && <Link to="/audit">全局审计</Link>}
            <Tag>{roles[user.platformRole] || user.displayName}</Tag>
            <Button
              size="small"
              onClick={async () => {
                await api('/api/auth/logout', 'POST')
                queryClient.clear()
                await refresh()
              }}
            >
              退出登录
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content>
          <Routes>
            <Route
              path="/"
              element={
                <main className="content">
                  <Projects user={user} />
                </main>
              }
            />
            <Route path="/projects/:projectId/:view?" element={<ProjectWorkspace />} />
            <Route
              path="/platform"
              element={
                <main className="content">
                  <Platform user={user} />
                </main>
              }
            />
            <Route
              path="/audit"
              element={
                <main className="content">
                  <AuditView />
                </main>
              }
            />
          </Routes>
        </Layout.Content>
      </Layout>
    </Session.Provider>
  )
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      theme={{
        token: {
          colorPrimary: '#0f766e',
          borderRadius: 6,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>
)
