import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Layout,
  List,
  Menu,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography
} from 'antd'
import { api, roles, states, useSession, type Row } from './api'
import { Action, Details, FileLink, Status, EvidenceUpload } from './components'
import { agentTypes } from '../../src/shared/contracts'
const nav = [
  ['overview', '项目概览'],
  ['changes', '变更工作台'],
  ['review', '代码与 Review'],
  ['tests', '测试与证据'],
  ['release', '发布与环境'],
  ['agents', 'AI 运行'],
  ['audit', '项目审计'],
  ['settings', '项目设置']
]
export function ProjectWorkspace() {
  const { projectId = '', view = 'overview' } = useParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const [selected, setSelected] = useState('')
  const query = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api(`/api/projects/${projectId}`)
  })
  const p = query.data
  const cid = selected || p?.changes[0]?.id
  const change = useQuery({
    queryKey: ['change', cid],
    queryFn: () => api(`/api/changes/${cid}`),
    enabled: !!cid,
    refetchInterval: view === 'agents' ? 3000 : false
  })
  if (query.error)
    return (
      <main className="content">
        <Alert type="error" message={query.error.message} />
      </main>
    )
  if (!p) return <Card loading />
  const role = p.members[user.id]
  const readOnly = !!user.platformRole || role === 'project_stakeholder'
  const manage = role === 'project_owner' || user.platformRole === 'platform_admin'
  const owner = role === 'project_owner' && !user.platformRole
  return (
    <Layout>
      <Layout.Sider className="app-sider" width={224} breakpoint="lg" collapsedWidth={0}>
        <div className="project-switch">
          <Typography.Text type="secondary">当前项目</Typography.Text>
          <strong>{p.name}</strong>
          <Tag>{roles[role] || roles[user.platformRole]}</Tag>
        </div>
        <Menu
          selectedKeys={[view]}
          items={nav.map(([key, label]) => ({ key, label }))}
          onClick={({ key }) => navigate(`/projects/${projectId}/${key}`)}
        />
      </Layout.Sider>
      <main className="content">
        <div className="page-heading">
          <div>
            <Typography.Text className="eyebrow">
              {p.code} / {nav.find(([key]) => key === view)?.[1]}
            </Typography.Text>
            <Typography.Title level={2}>{p.name}</Typography.Title>
            <Typography.Paragraph type="secondary">
              {p.description || '需求、版本、证据与人工决策的共同工作区。'}
            </Typography.Paragraph>
          </div>
          <Space wrap>
            <Tag>
              {p.template} {p.templateVersion}
            </Tag>
            {!readOnly && (
              <Action
                primary
                label="新建变更"
                url={`/api/projects/${p.id}/changes`}
                fields={[
                  { name: 'title', label: '一句话描述变更' },
                  {
                    name: 'type',
                    label: '类型',
                    options: [
                      { label: '需求', value: 'requirement' },
                      { label: '缺陷', value: 'defect' },
                      { label: '改进', value: 'improvement' }
                    ]
                  }
                ]}
                initial={{ type: 'improvement' }}
                after={(c) => {
                  setSelected(c.id)
                  navigate(`/projects/${p.id}/changes`)
                }}
              />
            )}
          </Space>
        </div>
        {['changes', 'review', 'tests', 'agents'].includes(view) && (
          <Select
            className="change-select"
            aria-label="当前变更"
            value={cid}
            options={p.changes.map((c: Row) => ({ value: c.id, label: `${c.key} · ${c.title}` }))}
            onChange={setSelected}
          />
        )}
        {view === 'overview' && (
          <>
            <div className="overview-grid">
              <Card title="需要我决定">
                <List
                  dataSource={p.changes.filter(
                    (c: Row) =>
                      c.blocked ||
                      c.confirmedRequirementsVersion !== c.requirementsVersion ||
                      c.confirmedDesignVersion !== c.designVersion
                  )}
                  locale={{ emptyText: '当前没有待确认事项' }}
                  renderItem={(c: Row) => (
                    <List.Item>
                      <Link to={`/projects/${p.id}/changes`} onClick={() => setSelected(c.id)}>
                        {c.key} · {c.title}
                      </Link>
                      <Tag color="orange">{c.blocked ? c.blockedReason : '需求或设计待确认'}</Tag>
                    </List.Item>
                  )}
                />
              </Card>
              <Card title="环境版本">
                <List
                  dataSource={p.environments}
                  renderItem={(e: Row) => (
                    <List.Item>
                      <Link to={`/projects/${p.id}/release`}>{e.code}</Link>
                      <span>
                        {e.currentRevision ? `${e.currentRevision.slice(0, 8)} · 已核验` : '未发布'}
                      </span>
                    </List.Item>
                  )}
                />
              </Card>
              <Card title="进行中的变更">
                <List
                  dataSource={p.changes.filter((c: Row) => c.status !== 'completed')}
                  renderItem={(c: Row) => (
                    <List.Item>
                      <Link to={`/projects/${p.id}/changes`} onClick={() => setSelected(c.id)}>
                        {c.key} · {c.title}
                      </Link>
                      <Status value={c.status} />
                    </List.Item>
                  )}
                />
              </Card>
              <Card title="证据缺口">
                <List
                  dataSource={p.changes.filter(
                    (c: Row) => !c.headRevision || c.blocked || !c.confirmedDesignVersion
                  )}
                  locale={{ emptyText: '查看测试与发布页面核对最新证据' }}
                  renderItem={(c: Row) => (
                    <List.Item>
                      <Link to={`/projects/${p.id}/tests`} onClick={() => setSelected(c.id)}>
                        {c.key}
                      </Link>
                      <span>{!c.headRevision ? '未关联固定 Git 提交' : c.blockedReason || '设计待确认'}</span>
                    </List.Item>
                  )}
                />
              </Card>
            </div>
            <Semantic cid={cid} />
          </>
        )}
        {view === 'changes' && change.data && (
          <ChangeView c={change.data} p={p} readOnly={readOnly} owner={owner} />
        )}
        {view === 'review' && change.data && (
          <>
            <Semantic cid={cid} />
            <ReviewView c={change.data} readOnly={readOnly} owner={owner} />
          </>
        )}
        {view === 'tests' && change.data && (
          <TestView c={change.data} p={p} readOnly={readOnly} manage={manage} />
        )}
        {view === 'agents' && change.data && <AgentView c={change.data} readOnly={readOnly} />}
        {view === 'release' && <ReleaseView p={p} readOnly={readOnly} owner={owner} manage={manage} />}
        {view === 'audit' && <AuditView projectId={p.id} />}
        {view === 'settings' && <Settings p={p} manage={manage} />}
        {['changes', 'review', 'tests', 'agents'].includes(view) && !cid && (
          <Empty description="先创建一项变更" />
        )}
      </main>
    </Layout>
  )
}
function ChangeView({ c, p, readOnly, owner }: { c: Row; p: Row; readOnly: boolean; owner: boolean }) {
  const url = `/api/changes/${c.id}`
  return (
    <>
      <Card
        title={
          <Space>
            <span>
              {c.key} · {c.title}
            </span>
            <Status value={c.status} />
            {c.blocked && <Tag color="red">{c.blockedReason}</Tag>}
          </Space>
        }
        extra={
          !readOnly && (
            <Action
              label="更新状态"
              url={`${url}/status`}
              method="PATCH"
              confirm
              target={c.key}
              fields={[
                {
                  name: 'status',
                  label: '下一状态',
                  options: ['inbox', 'ready', 'in_progress', 'awaiting_acceptance', 'completed']
                }
              ]}
            />
          )
        }
      >
        <Tabs
          items={[
            {
              key: 'goal',
              label: '目标与验收',
              children: (
                <>
                  <Descriptions column={1}>
                    <Descriptions.Item label="目标">{c.requirements.summary}</Descriptions.Item>
                    <Descriptions.Item label="用户故事">
                      {c.requirements.userStory || '待补充'}
                    </Descriptions.Item>
                    <Descriptions.Item label="版本">
                      v{c.requirementsVersion} ·{' '}
                      {c.confirmedRequirementsVersion === c.requirementsVersion ? '人工已确认' : '草稿'}
                    </Descriptions.Item>
                  </Descriptions>
                  <List
                    dataSource={c.requirements.acceptanceCriteria}
                    renderItem={(item: string) => <List.Item>{item}</List.Item>}
                  />
                  <Space wrap>
                    {!readOnly && (
                      <Action
                        label="编辑需求"
                        url={`${url}/requirements`}
                        method="PUT"
                        target={c.key}
                        initial={c.requirements}
                        fields={[
                          { name: 'summary', label: '目标', kind: 'area' },
                          { name: 'userStory', label: '用户故事', kind: 'area', required: false },
                          { name: 'acceptanceCriteria', label: '验收标准（每行一条）', kind: 'lines' },
                          { name: 'nfr', label: '非功能要求（每行一条）', kind: 'lines', required: false },
                          { name: 'scope', label: '范围', kind: 'area', required: false }
                        ]}
                      />
                    )}
                    <Action
                      label="确认需求"
                      url={`${url}/confirm-requirements`}
                      confirm
                      disabled={!owner}
                      target={c.key}
                      version={`需求 v${c.requirementsVersion}`}
                    />
                  </Space>
                </>
              )
            },
            {
              key: 'design',
              label: '设计与影响',
              children: (
                <>
                  <Typography.Paragraph>
                    {c.design?.summary || '先保存设计草稿，再由负责人确认。'}
                  </Typography.Paragraph>
                  {c.design && <Details value={c.design} />}
                  <Space wrap>
                    {!readOnly && (
                      <Action
                        label="编辑设计"
                        url={`${url}/design`}
                        method="PUT"
                        target={c.key}
                        initial={c.design || { impact: [], risks: [], unknowns: [] }}
                        fields={[
                          { name: 'summary', label: '设计概要', kind: 'area' },
                          { name: 'impact', label: '影响范围（每行一条）', kind: 'lines', required: false },
                          { name: 'risks', label: '风险（每行一条）', kind: 'lines', required: false },
                          { name: 'unknowns', label: '未知依赖（每行一条）', kind: 'lines', required: false }
                        ]}
                      />
                    )}
                    <Action
                      label="确认设计"
                      url={`${url}/confirm-design`}
                      confirm
                      disabled={!owner}
                      target={c.key}
                      version={`设计 v${c.designVersion}`}
                    />
                  </Space>
                  <Semantic cid={c.id} />
                </>
              )
            },
            {
              key: 'development',
              label: '开发与 PR',
              children: (
                <>
                  <Alert
                    type="info"
                    message="在外部 AI 开发平台开发；这里交接已确认的上下文并回收 Git 证据。"
                  />
                  <Space wrap className="actions">
                    <Action
                      label="生成上下文包"
                      url={`${url}/context-package`}
                      disabled={readOnly}
                      target={c.key}
                    />
                    <Action
                      label="关联提交或同步 PR"
                      url={`${url}/git-link`}
                      disabled={readOnly}
                      target={c.key}
                      fields={[
                        { name: 'baseRevision', label: '基线提交 SHA（40 位）', required: false },
                        { name: 'headRevision', label: '候选提交 SHA（40 位）', required: false },
                        { name: 'branch', label: '分支', required: false },
                        {
                          name: 'prNumber',
                          label: 'Gitea PR 编号（填写后从 Git 读取提交）',
                          kind: 'number',
                          required: false
                        }
                      ]}
                    />
                  </Space>
                  <List
                    dataSource={c.links}
                    renderItem={(l: Row) => (
                      <List.Item>
                        <span>
                          {l.type || l.linkType} · {l.externalKey || `v${l.version}`}
                        </span>
                        {l.fileId ? <FileLink id={l.fileId} label="下载上下文包" /> : <Details value={l} />}
                      </List.Item>
                    )}
                  />
                </>
              )
            },
            {
              key: 'evidence',
              label: '测试与审查',
              children: (
                <>
                  <ReviewView c={c} readOnly={readOnly} owner={owner} />
                  <TestView c={c} p={p} readOnly={readOnly} manage={owner} />
                </>
              )
            },
            {
              key: 'release',
              label: '发布',
              children: <Link to={`/projects/${p.id}/release`}>查看候选版本、批准与环境核验</Link>
            }
          ]}
        />
      </Card>
      <Card title="版本与不可编辑时间线" className="section-card">
        <Timeline
          items={c.versions.map((v: Row) => ({
            children: (
              <Space>
                <span>
                  {v.kind} v{v.versionNo} · {v.confirmedBy ? `确认人 ${v.confirmedBy}` : '草稿'} ·{' '}
                  {new Date(v.createdAt).toLocaleString()}
                </span>
                <Details value={v.content} />
              </Space>
            )
          }))}
        />
        <Link to={`/projects/${p.id}/audit`}>查看关联审计事件</Link>
      </Card>
    </>
  )
}
export function Semantic({ cid }: { cid?: string }) {
  const [profile, setProfile] = useState('all')
  const [node, setNode] = useState<Row | null>(null)
  const q = useQuery({
    queryKey: ['diff', cid],
    queryFn: () => api(`/api/changes/${cid}/semantic-diff`),
    enabled: !!cid
  })
  const d = q.data
  const match = (n: Row) =>
    profile === 'all' ||
    (profile === 'phoenix_dsl'
      ? n.path.startsWith('documents/')
      : profile === 'typescript'
        ? /\.tsx?$/.test(n.path)
        : profile === 'javascript'
          ? /\.jsx?$/.test(n.path)
          : profile === 'css'
            ? /\.(css|scss|less)$/.test(n.path)
            : /\.sql$/.test(n.path))
  return (
    <Card
      title="变化可视化"
      className="section-card"
      extra={<FileLink id={d?.rawDiffRef} label="下载原始 diff" />}
    >
      {!d ? (
        <Empty description="关联固定提交后生成语义差异" />
      ) : (
        <>
          <Space wrap>
            <Select
              aria-label="技术栈筛选"
              value={profile}
              onChange={setProfile}
              options={[
                { value: 'all', label: '全部技术栈' },
                ...d.profiles.map((p: string) => ({ value: p, label: p }))
              ]}
            />
            <span>解析覆盖 {Math.round(d.coverage * 100)}%</span>
            {[
              ['added', '新增'],
              ['deleted', '删除'],
              ['modified', '修改'],
              ['unchanged', '未变化']
            ].map(([value, label]) => (
              <Tag key={value}>
                {label} {d.nodes.filter((n: Row) => n.change === value).length}
              </Tag>
            ))}
          </Space>
          {d.unknowns.length > 0 && (
            <Alert
              className="actions"
              type="warning"
              message="语义分析不完整"
              description={d.unknowns.map((u: Row) => `${u.path}: ${u.reason}`).join('；')}
            />
          )}
          <div className="semantic-grid">
            {d.nodes
              .filter(match)
              .filter((n: Row) => n.change !== 'unchanged')
              .map((n: Row) => (
                <button className={`graph-node ${n.change}`} key={n.id} onClick={() => setNode(n)}>
                  <strong>{n.label}</strong>
                  <span>
                    {n.kind} · {({ added: '新增', deleted: '删除', modified: '修改' } as Row)[n.change]}
                  </span>
                  <small>{n.path}</small>
                </button>
              ))}
          </div>
          <Collapse
            items={[
              {
                key: 'edges',
                label: `关系与依赖 · ${d.edges.length}`,
                children: (
                  <List
                    dataSource={d.edges}
                    renderItem={(e: Row) => (
                      <List.Item>
                        {e.from} → {e.to} · {e.kind} · {e.change}
                      </List.Item>
                    )}
                  />
                )
              }
            ]}
          />
        </>
      )}
      <Modal open={!!node} title="资源与版本证据" onCancel={() => setNode(null)} footer={null}>
        <Descriptions column={1}>
          <Descriptions.Item label="路径">
            {node?.path}:{node?.line}
          </Descriptions.Item>
          <Descriptions.Item label="基线">{d?.baseRevision}</Descriptions.Item>
          <Descriptions.Item label="候选">{d?.headRevision}</Descriptions.Item>
          <Descriptions.Item label="资源">{node?.id}</Descriptions.Item>
          <Descriptions.Item label="风险">{node?.riskTags?.join('、') || '无已识别标签'}</Descriptions.Item>
        </Descriptions>
        <FileLink id={d?.rawDiffRef} label="查看原始版本差异" />
      </Modal>
    </Card>
  )
}
function ReviewView({ c, readOnly, owner }: { c: Row; readOnly: boolean; owner: boolean }) {
  return (
    <Card title="Review 与人工处置" className="section-card">
      <Space wrap>
        <Action
          label="触发 AI Review"
          url={`/api/changes/${c.id}/ai-runs`}
          initial={{ agentType: 'review-agent' }}
          disabled={readOnly}
        />
        <Action
          label="登记人工 Review"
          url={`/api/changes/${c.id}/reviews`}
          initial={{ findings: [] }}
          disabled={readOnly}
          target={c.key}
        />
        <Action
          label="引用 AI findings"
          url={`/api/changes/${c.id}/reviews`}
          disabled={readOnly}
          fields={[
            {
              name: 'agentRunId',
              label: '已成功的 Review Agent 运行',
              options: c.aiRuns
                .filter((r: Row) => r.agentType === 'review-agent' && r.status === 'succeeded')
                .map((r: Row) => ({ value: r.id, label: r.id }))
            }
          ]}
        />
      </Space>
      {c.reviews.map((r: Row) => (
        <Card
          key={r.id}
          size="small"
          className="section-card"
          title={
            <Space>
              <span>{r.id.slice(0, 20)}</span>
              <Status value={r.status} stale={r.stale} />
            </Space>
          }
          extra={
            <Action
              label="确认审查"
              url={`/api/reviews/${r.id}/confirm`}
              confirm
              disabled={!owner}
              target={r.id}
              version={r.revision}
            />
          }
        >
          <Table<Row>
            rowKey="id"
            size="small"
            dataSource={r.findings}
            pagination={false}
            scroll={{ x: 700 }}
            columns={[
              { title: '严重性', dataIndex: 'severity' },
              {
                title: '发现项',
                render: (_, f) => (
                  <>
                    <Typography.Text>{f.message}</Typography.Text>
                    <div className="muted">
                      {f.path}:{f.line || 1}
                    </div>
                  </>
                )
              },
              { title: '状态', render: (_, f) => <Status value={f.state} /> },
              {
                title: '处置',
                render: (_, f) => (
                  <Space>
                    <Details value={f} />
                    <Action
                      label="处理"
                      disabled={readOnly}
                      url={`/api/reviews/${r.id}/findings/${f.id}`}
                      method="PATCH"
                      initial={{ state: 'fixed' }}
                      fields={[
                        {
                          name: 'state',
                          label: '处理结果',
                          options: owner ? ['fixed', 'accepted', 'false_positive', 'open'] : ['fixed', 'open']
                        },
                        { name: 'reason', label: '原因（例外/误报必填）', kind: 'area', required: false }
                      ]}
                    />
                  </Space>
                )
              }
            ]}
          />
        </Card>
      ))}
    </Card>
  )
}
function TestView({ c, p, readOnly, manage }: { c: Row; p: Row; readOnly: boolean; manage: boolean }) {
  const definitions = useQuery({
    queryKey: ['test-definitions', p.id],
    queryFn: () => api(`/api/projects/${p.id}/test-definitions`)
  })
  return (
    <Card title="测试与证据" className="section-card">
      <Space wrap>
        <EvidenceUpload changeId={c.id} disabled={readOnly} />
        <Action
          label="生成测试草稿"
          url={`/api/changes/${c.id}/ai-runs`}
          disabled={readOnly}
          initial={{ agentType: 'test-agent' }}
        />
        <Action
          label="上传人工报告"
          url={`/api/changes/${c.id}/evidence`}
          disabled={readOnly}
          fields={[
            { name: 'name', label: '报告名称' },
            { name: 'content', label: '实际测试过程与结果', kind: 'area' }
          ]}
        />
        <Action
          label="记录人工测试结果"
          url={`/api/changes/${c.id}/test-runs`}
          disabled={readOnly}
          fields={[
            {
              name: 'reportRef',
              label: '已上传的报告',
              options: (c.evidence || []).map((f: Row) => ({ value: f.id, label: f.name }))
            },
            { name: 'status', label: '结果', options: ['passed', 'failed', 'not_executed'] },
            ...['total', 'passed', 'failed', 'skipped'].map((name, i) => ({
              name,
              label: ['总数', '通过数', '失败数', '未执行数'][i],
              kind: 'number' as const
            }))
          ]}
          initial={{ total: 1, passed: 0, failed: 0, skipped: 1, status: 'not_executed' }}
          transform={(v) => ({
            status: v.status,
            reportRef: v.reportRef,
            result: { total: v.total, passed: v.passed, failed: v.failed, skipped: v.skipped }
          })}
        />
        <Action
          label="启动登记测试"
          url={`/api/changes/${c.id}/test-runs`}
          disabled={readOnly}
          fields={[
            {
              name: 'definitionId',
              label: '测试入口',
              options: (definitions.data?.items || []).map((d: Row) => ({ value: d.id, label: d.name }))
            }
          ]}
        />
        {manage && (
          <Action
            label="登记测试入口"
            url={`/api/projects/${p.id}/test-definitions`}
            fields={[
              { name: 'name', label: '测试名称' },
              { name: 'commandRef', label: '运维已登记的命令引用' },
              { name: 'kind', label: '测试类型', options: ['unit', 'integration', 'e2e'] },
              { name: 'environmentRef', label: '测试环境引用' }
            ]}
          />
        )}
      </Space>
      <List
        dataSource={c.evidence || []}
        renderItem={(f: Row) => (
          <List.Item>
            <Space>
              <span>{f.name}</span>
              <Typography.Text copyable code>
                {f.id}
              </Typography.Text>
              <FileLink id={f.id} />
            </Space>
          </List.Item>
        )}
      />
      <Table<Row>
        className="section-card"
        rowKey="id"
        dataSource={c.tests}
        scroll={{ x: 700 }}
        columns={[
          { title: '来源', render: (_, t) => (t.source === 'manual' ? '人工提供' : '登记测试') },
          { title: '提交', render: (_, t) => t.revision?.slice(0, 12) },
          { title: '状态', render: (_, t) => <Status value={t.status} stale={t.stale} /> },
          {
            title: '结果',
            render: (_, t) => (t.result ? `${t.result.passed}/${t.result.total} 通过` : '尚无结果')
          },
          {
            title: '证据',
            render: (_, t) => (
              <Space>
                <FileLink id={t.reportRef} />
                <Details value={t} />
              </Space>
            )
          }
        ]}
      />
    </Card>
  )
}
function AgentView({ c, readOnly }: { c: Row; readOnly: boolean }) {
  return (
    <Card title="AI 运行">
      <Alert type="info" message="AI 输出是建议；运行失败不影响人工工作流程。" />
      <Space wrap className="actions">
        <Action
          label="运行 Agent"
          url={`/api/changes/${c.id}/ai-runs`}
          fields={[{ name: 'agentType', label: '任务类型', options: [...agentTypes] }]}
          disabled={readOnly}
        />
      </Space>
      <List
        dataSource={c.aiRuns}
        renderItem={(r: Row) => (
          <List.Item>
            <div>
              <Space>
                <strong>{r.agentType}</strong>
                <Status value={r.status} stale={r.stale} />
              </Space>
              <div className="muted">
                {r.id} · {r.sourceRevision || '需求上下文'}
              </div>
              {r.error && <Alert type="error" message={r.error} />}
              {r.output && (
                <>
                  <Typography.Paragraph>{r.output.summary}</Typography.Paragraph>
                  <div>依据：{r.output.evidence.join('；')}</div>
                  <div>风险：{r.output.risks.join('；') || '未报告'}</div>
                  <div>待确认：{r.output.questions.join('；') || '无'}</div>
                </>
              )}
              <Space className="actions">
                <Details value={r} />
                {['failed', 'expired', 'cancelled'].includes(r.status) && (
                  <Action label="重试" url={`/api/ai-runs/${r.id}/retry`} disabled={readOnly} />
                )}{' '}
                {['queued', 'running'].includes(r.status) && (
                  <Action label="取消" url={`/api/ai-runs/${r.id}/cancel`} disabled={readOnly} />
                )}{' '}
                {r.output && ['intake-agent', 'design-impact-agent'].includes(r.agentType) && (
                  <Action
                    label="应用为新草稿版本"
                    url={`/api/ai-runs/${r.id}/apply`}
                    disabled={readOnly || r.stale}
                  />
                )}
              </Space>
            </div>
          </List.Item>
        )}
      />
    </Card>
  )
}
function ReleaseView({
  p,
  readOnly,
  owner,
  manage
}: {
  p: Row
  readOnly: boolean
  owner: boolean
  manage: boolean
}) {
  const q = useQuery({ queryKey: ['releases', p.id], queryFn: () => api(`/api/projects/${p.id}/releases`) })
  const [preflight, setPreflight] = useState<Row | null>(null)
  return (
    <>
      <Card title="环境与候选版本">
        <List
          dataSource={q.data?.environments || []}
          renderItem={(e: Row) => (
            <List.Item>
              <Space>
                <strong>{e.code}</strong>
                <span>{e.currentRevision?.slice(0, 12) || '未发布'}</span>
                <Tag>配置 {e.configVersion}</Tag>
                {e.safetyBlocked && <Tag color="red">安全否决</Tag>}
              </Space>
              {manage && (
                <Action
                  label="配置环境"
                  url={`/api/projects/${p.id}/environments/${e.code}`}
                  method="PUT"
                  confirm
                  target={p.name}
                  environment={e.code}
                  initial={{ configVersion: e.configVersion, targetRef: e.targetRef }}
                  fields={[
                    { name: 'configVersion', label: '配置版本' },
                    { name: 'targetRef', label: '人工发布目标引用' }
                  ]}
                />
              )}
            </List.Item>
          )}
        />
        <Action
          primary
          disabled={readOnly}
          label="创建候选版本"
          url={`/api/projects/${p.id}/releases`}
          fields={[
            { name: 'version', label: '版本号' },
            { name: 'sourceRevision', label: '源提交 SHA（40 位）' },
            { name: 'artifactRef', label: '制品 SHA-256 摘要' },
            { name: 'configRef', label: '配置引用' },
            { name: 'changeIds', label: '关联变更 ID（每行一个）', kind: 'lines' },
            { name: 'runbook', label: '实际发布运行手册', kind: 'area' },
            { name: 'recovery', label: '恢复与回滚步骤', kind: 'area' }
          ]}
          initial={{ changeIds: p.changes.map((c: Row) => c.id) }}
        />
        <Typography.Paragraph type="secondary" className="actions">
          同一制品按 test → prod 晋级；预检通过后由负责人批准，执行人回传实际版本与报告。
        </Typography.Paragraph>
      </Card>
      {q.data?.items.map((r: Row) => (
        <Card className="section-card" key={r.id} title={`候选 ${r.version}`} extra={<Details value={r} />}>
          <Descriptions column={1}>
            <Descriptions.Item label="提交">{r.sourceRevision}</Descriptions.Item>
            <Descriptions.Item label="制品">{r.artifactRef}</Descriptions.Item>
            <Descriptions.Item label="恢复方式">{r.recovery}</Descriptions.Item>
          </Descriptions>
          {['test', 'prod'].map((environment) => (
            <div className="actions" key={environment}>
              <Space wrap>
                <Tag color={environment === 'prod' ? 'orange' : 'blue'}>{environment}</Tag>
                <Action
                  label={`${environment} 预检`}
                  url={`/api/releases/${r.id}/preflight`}
                  initial={{ environment }}
                  disabled={readOnly}
                  after={setPreflight}
                />
                <Action
                  label={`批准 ${environment}`}
                  url={`/api/releases/${r.id}/approve`}
                  initial={{ environment }}
                  disabled={!owner}
                  confirm
                  target={r.id}
                  version={`${r.version} / ${r.sourceRevision}`}
                  environment={environment}
                  recovery={r.recovery}
                />
                <Action
                  label={`登记 ${environment} 发布`}
                  url={`/api/releases/${r.id}/deployments`}
                  initial={{ environment }}
                  disabled={readOnly}
                  confirm
                  target={r.id}
                  version={`${r.version} / ${r.artifactRef}`}
                  environment={environment}
                  recovery={r.recovery}
                />
                {r.approvals[environment] && <Tag color="green">已批准</Tag>}
              </Space>
            </div>
          ))}
        </Card>
      ))}
      <Card className="section-card" title="部署与核验证据">
        <List
          dataSource={q.data?.deployments || []}
          renderItem={(d: Row) => (
            <List.Item>
              <div>
                <Space>
                  <strong>{d.environment}</strong>
                  <Status value={d.status} />
                  <span>{d.expectedRevision.slice(0, 12)}</span>
                  <Details value={d} />
                  <FileLink id={d.reportRef} />
                </Space>
                <Space wrap className="actions">
                  {d.status === 'awaiting_evidence' && (
                    <Action
                      label="回传实际核验"
                      disabled={readOnly}
                      url={`/api/deployments/${d.id}/verify`}
                      initial={{ environment: d.environment, status: 'verified' }}
                      fields={[
                        { name: 'status', label: '核验结果', options: ['verified', 'failed'] },
                        { name: 'verifiedRevision', label: '实际提交 SHA' },
                        { name: 'verifiedArtifactRef', label: '实际制品摘要' },
                        { name: 'configVersion', label: '实际配置版本' },
                        { name: 'reportRef', label: '实际报告文件 ID' },
                        { name: 'externalOperationId', label: '外部操作 ID' }
                      ]}
                      target={d.id}
                    />
                  )}
                  <Action
                    label="生成回滚计划"
                    url={`/api/deployments/${d.id}/rollback-plan`}
                    disabled={readOnly}
                    target={d.id}
                    after={setPreflight}
                  />
                </Space>
              </div>
            </List.Item>
          )}
        />
      </Card>
      <Modal open={!!preflight} title="检查与恢复步骤" footer={null} onCancel={() => setPreflight(null)}>
        {preflight?.checks ? (
          <List
            dataSource={preflight.checks}
            renderItem={(c: Row) => (
              <List.Item>
                {c.name}
                <Tag color={c.passed ? 'green' : 'red'}>{c.passed ? '通过' : '未通过'}</Tag>
              </List.Item>
            )}
          />
        ) : (
          <pre className="record-json">{JSON.stringify(preflight, null, 2)}</pre>
        )}
      </Modal>
    </>
  )
}
function Settings({ p, manage }: { p: Row; manage: boolean }) {
  const [preview, setPreview] = useState<Row | null>(null)
  const r = useQuery({ queryKey: ['roles', p.id], queryFn: () => api(`/api/projects/${p.id}/roles`) })
  const [memberId, setMemberId] = useState('')
  return (
    <>
      <Card title="模板与仓库">
        <Space wrap>
          <Action
            label="预览模板"
            url={`/api/projects/${p.id}/template-preview`}
            disabled={!manage}
            after={setPreview}
          />
          {preview && (
            <Action
              label="应用模板"
              url={`/api/projects/${p.id}/template-apply`}
              initial={{ fingerprint: preview.fingerprint }}
              disabled={!manage}
              confirm
              target={`${p.name} / ${p.template}`}
              version={p.templateVersion}
              recovery="下载模板文件快照，合并到仓库后可通过 Git 回退"
            />
          )}
          <Action
            label="绑定 Git 仓库"
            url={`/api/projects/${p.id}/repository`}
            method="PUT"
            disabled={!manage}
            initial={{ defaultBranch: 'main' }}
            fields={[
              { name: 'url', label: '登记 Git 服务的 Clone URL' },
              { name: 'repoKey', label: '仓库标识 owner/repo' },
              { name: 'defaultBranch', label: '主分支' },
              { name: 'credentialRef', label: '凭证环境变量引用（可选）', required: false }
            ]}
          />
          <Action
            label="覆盖技术栈识别"
            url={`/api/projects/${p.id}/stack-profiles`}
            method="PUT"
            disabled={!manage}
            fields={[
              {
                name: 'profileCode',
                label: '技术栈',
                options: ['phoenix_dsl', 'typescript', 'javascript', 'css', 'sql']
              },
              { name: 'reason', label: '人工覆盖原因' }
            ]}
          />
        </Space>
        {preview && (
          <List
            dataSource={preview.files}
            renderItem={(f: Row) => (
              <List.Item>
                {f.path}
                <Tag>{f.action}</Tag>
              </List.Item>
            )}
          />
        )}
        <List
          dataSource={p.repositories}
          renderItem={(repo: Row) => (
            <List.Item>
              {repo.repoKey} · {repo.defaultBranch} · {repo.url}
            </List.Item>
          )}
        />
      </Card>
      <Card title="项目成员与角色" className="section-card">
        <Table<Row>
          rowKey={(row) => row.user.id}
          dataSource={r.data?.items || []}
          columns={[
            { title: '用户', render: (_, r) => `${r.user.displayName} (${r.user.id})` },
            { title: '角色', render: (_, r) => roles[r.role] }
          ]}
        />
        <Space wrap>
          <Input
            aria-label="成员用户 ID"
            placeholder="已有用户 ID"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          />
          <Action
            label="分配项目角色"
            url={`/api/projects/${p.id}/roles/${memberId}`}
            method="PUT"
            disabled={!manage || !memberId}
            confirm
            target={`${p.name} / ${memberId}`}
            recovery="负责人可以撤销成员或干系人绑定"
            fields={[
              {
                name: 'role',
                label: '项目角色',
                options: [
                  { label: '项目成员', value: 'project_member' },
                  { label: '只读干系人', value: 'project_stakeholder' }
                ]
              }
            ]}
          />
        </Space>
      </Card>
    </>
  )
}
export function AuditView({ projectId }: { projectId?: string }) {
  const [filters, setFilters] = useState<Row>({})
  const [query, setQuery] = useState<Row>({})
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({
    ...query,
    ...(projectId ? { project_id: projectId } : {}),
    page: String(page),
    page_size: '20'
  })
  const q = useQuery({
    queryKey: ['audit', projectId, query, page],
    queryFn: () => api(`/api/audit/events?${params}`)
  })
  const fields = [
    ['from', '开始时间 ISO'],
    ['to', '结束时间 ISO'],
    ['actor', '人员 ID'],
    ['role', '角色'],
    ['action', '动作'],
    ['result', '结果'],
    ['resource_type', '资源类型'],
    ['correlation_id', '关联 ID'],
    ['event_id', '事件 ID'],
    ['keyword', '关键字']
  ]
  return (
    <Card title={projectId ? '项目审计' : '全局审计'}>
      <div className="filter-grid">
        {fields.map(([key, label]) => (
          <Input
            key={key}
            aria-label={label}
            placeholder={label}
            value={filters[key]}
            onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
          />
        ))}
      </div>
      <Space className="actions">
        <Button
          type="primary"
          onClick={() => {
            setQuery(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)))
            setPage(1)
          }}
        >
          查询
        </Button>
        <Button
          onClick={() =>
            Modal.confirm({
              title: '确认导出审计',
              content: `对象：${projectId || '全局审计'}；版本：当前查询条件；环境：平台；恢复方式：本地导出文件可删除，源审计不可修改。`,
              onOk: () => {
                window.location.assign(`/api/audit/export?${params}&confirmed=true`)
              }
            })
          }
        >
          导出授权范围
        </Button>
      </Space>
      {q.error && <Alert type="error" message={q.error.message} />}
      <Table<Row>
        rowKey="eventId"
        loading={q.isLoading}
        scroll={{ x: 1100 }}
        dataSource={q.data?.items || []}
        pagination={{ current: page, pageSize: 20, total: q.data?.page.total || 0, onChange: setPage }}
        columns={[
          { title: '时间', dataIndex: 'occurredAt' },
          {
            title: '人员 / 角色',
            render: (_, e) => `${e.actor.id} / ${roles[e.actor.role] || e.actor.role}`
          },
          { title: '动作', dataIndex: 'action' },
          { title: '结果', dataIndex: 'result' },
          {
            title: '来源 / 校验',
            render: (_, e) => (
              <>
                <span>{e.sourceFile}</span>
                <div>
                  <Tag color={e.integrity === 'verified' ? 'green' : 'red'}>
                    {e.integrity === 'verified' ? '哈希链校验通过' : '校验失败'}
                  </Tag>
                </div>
              </>
            )
          },
          { title: '关联记录', render: (_, e) => <Details value={e} title={e.eventId} /> }
        ]}
      />
    </Card>
  )
}
