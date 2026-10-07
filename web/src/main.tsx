import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import {
  ConfigProvider,
  App,
  Button,
  Card,
  Select,
  Space,
  Tag,
  Spin,
  Alert,
  Form,
  Input,
  Steps,
  Timeline,
  Typography,
  Checkbox,
  Segmented,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import AppstoreOutlined from "@ant-design/icons/AppstoreOutlined";
import BranchesOutlined from "@ant-design/icons/BranchesOutlined";
import RocketOutlined from "@ant-design/icons/RocketOutlined";
import SafetyCertificateOutlined from "@ant-design/icons/SafetyCertificateOutlined";
import SettingOutlined from "@ant-design/icons/SettingOutlined";
import PlusOutlined from "@ant-design/icons/PlusOutlined";
import ArrowRightOutlined from "@ant-design/icons/ArrowRightOutlined";
import LogoutOutlined from "@ant-design/icons/LogoutOutlined";
import ReloadOutlined from "@ant-design/icons/ReloadOutlined";
import CodeOutlined from "@ant-design/icons/CodeOutlined";
import ReadOutlined from "@ant-design/icons/ReadOutlined";
import CheckCircleOutlined from "@ant-design/icons/CheckCircleOutlined";
import ClockCircleOutlined from "@ant-design/icons/ClockCircleOutlined";
import {
  api,
  act,
  setCsrf,
  label,
  shortSha,
  date,
  type Workspace,
  type Row,
} from "./api";
import {
  Status,
  PageTitle,
  Code,
  Blank,
  JsonEditor,
  ActionForm,
  Field,
  Detail,
} from "./components";
import { projectDefaults, newPlan, newMaterials } from "./templates";
import "./style.css";
import { PlanEditor, MaterialsEditor, SystemEditorForm } from "./editors";
const Ctx = createContext<any>(null);
const useData = () => useContext(Ctx);
function Application() {
  const [session, setSession] = useState<any>(),
    [workspace, setWorkspace] = useState<Workspace>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [projectId, setProjectId] = useState(
      localStorage.getItem("devops-project") || "",
    );
  const refresh = async () => {
    try {
      const ss = await api("/session");
      setCsrf(ss.csrf);
      setSession(ss);
      const w = await api("/workspace");
      setWorkspace(w);
      setProjectId((id: string) =>
        w.projects.some((p: Row) => p.id === id) ? id : w.projects[0]?.id || "",
      );
      setError("");
    } catch (e: any) {
      if (e.status === 401) {
        setSession(null);
        setWorkspace(undefined);
      } else setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    localStorage.setItem("devops-project", projectId);
  }, [projectId]);
  if (loading)
    return (
      <div className="loading">
        <Spin size="large" />
        <p>正在读取工作区…</p>
      </div>
    );
  if (!session)
    return (
      <div className="login">
        <div className="login-art">
          <div className="brand">
            <span>序</span> DevOps
          </div>
          <h1>
            让每一次交付，
            <br />
            都有据可循。
          </h1>
          <p>
            从意图到实际结果。
            <br />
            人类掌握决策，Agent 各司其职。
          </p>
          <div className="orbit">
            <div>意图</div>
            <i />
            <div>证据</div>
            <i />
            <div>交付</div>
          </div>
          <small>AI NATIVE DEVELOPMENT · HUMAN IN CONTROL</small>
        </div>
        <div className="login-panel">
          <Tag color="purple">一个账号 · 同一工作区</Tag>
          <h2>进入你的交付工作台</h2>
          <p>
            使用统一账号和用户名密码登录。IDE 的短时 Git 凭证也由此账号授权。
          </p>
          {error && <Alert type="error" message={error} />}
          <Button type="primary" size="large" block href="/api/auth/login">
            用户名密码登录 <ArrowRightOutlined aria-hidden="true" />
          </Button>
          <p className="login-help">
            内置管理员账号为 <code>admin</code>，初始密码为 <code>admin</code>。
            首次使用默认密码登录后会提示修改密码，也可以暂时忽略。
          </p>
          <div className="login-note">
            <SafetyCertificateOutlined aria-hidden="true" />{" "}
            所有分支、合并和签发均有审计记录
          </div>
        </div>
      </div>
    );
  return (
    <Ctx.Provider
      value={{
        session,
        w: workspace,
        project: workspace?.projects.find((p) => p.id === projectId),
        projectId,
        selectProject: setProjectId,
        refresh,
      }}
    >
      <div className="shell">
        <aside className="sidebar">
          <Link to="/" className="brand">
            <span>序</span> DevOps
          </Link>
          <div className="workspace-label">工作区</div>
          <Select
            aria-label="当前项目"
            value={projectId || undefined}
            placeholder="选择项目"
            className="project-select"
            onChange={setProjectId}
            options={workspace?.projects.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
          />
          <nav>
            <NavLink to="/" end>
              <AppstoreOutlined aria-hidden="true" /> 待办与 Intent
            </NavLink>
            <NavLink to="/deliveries">
              <BranchesOutlined aria-hidden="true" /> PR 与组合交付
            </NavLink>
            <NavLink to="/operations">
              <RocketOutlined aria-hidden="true" /> 发布与运行
            </NavLink>
            <NavLink to="/settings">
              <SettingOutlined aria-hidden="true" /> 项目与授权
            </NavLink>
            <NavLink to="/audit">
              <SafetyCertificateOutlined aria-hidden="true" /> 审计轨迹
            </NavLink>
            {session.user.admin && (
              <NavLink to="/ops">
                <AppstoreOutlined aria-hidden="true" /> 系统运维
              </NavLink>
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="identity">
              <span className="avatar">
                {session.user.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{session.user.name}</strong>
                <small>
                  统一身份 · {session.user.admin ? "管理员" : "项目成员"}
                </small>
              </div>
              <Button
                aria-label="退出登录"
                type="text"
                icon={<LogoutOutlined aria-hidden="true" />}
                onClick={async () => {
                  await api("/auth/logout", {});
                  location.assign("/identity/user/logout");
                }}
              />
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <div className="topbar">
            <span>
              <span className="live-dot" /> 人类掌握决策 · 证据驱动交付
            </span>
            <Space>
              <span className="muted">Asia/Shanghai</span>
              <Button
                aria-label="刷新工作区"
                type="text"
                icon={<ReloadOutlined aria-hidden="true" />}
                onClick={refresh}
              />
            </Space>
          </div>
          <main>
            {session.defaultPasswordWarning && (
              <Alert
                className="default-password-alert"
                type="warning"
                showIcon
                message="当前仍在使用默认密码"
                description="为保护统一账号，建议立即设置新密码。你可以先忽略本次提示，下一次登录仍会提醒。"
                action={
                  <Space wrap>
                    <Button
                      type="link"
                      href="/identity/user/settings/change_password"
                    >
                      修改密码
                    </Button>
                    <Button
                      type="text"
                      onClick={async () => {
                        try {
                          await api("/session/default-password-dismiss", {});
                          setSession((current: any) =>
                            current
                              ? { ...current, defaultPasswordWarning: false }
                              : current,
                          );
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      本次忽略
                    </Button>
                  </Space>
                }
              />
            )}
            {error && (
              <Alert
                type="error"
                message={error}
                action={<Button onClick={refresh}>重试</Button>}
              />
            )}
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/projects/new" element={<ProjectForm />} />
              <Route path="/intents/new" element={<IntentForm />} />
              <Route path="/intents/:id" element={<IntentDetail />} />
              <Route path="/intents/:id/:editor" element={<IntentEditor />} />
              <Route path="/gate/:kind/:id/:gate" element={<GatePage />} />
              <Route path="/deliveries" element={<Deliveries />} />
              <Route path="/deliveries/:id" element={<DeliveryDetail />} />
              <Route path="/deliveries/:id/system" element={<SystemEditor />} />
              <Route path="/merge/:id" element={<MergePage />} />
              <Route path="/operations" element={<Operations />} />
              <Route path="/operations/:id" element={<OperationDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/credentials/new" element={<CredentialForm />} />
              <Route path="/users/new" element={<UserForm />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/ops" element={<Ops />} />
              <Route
                path="*"
                element={
                  <Blank title="页面不存在" link="/" button="返回工作台" />
                }
              />
            </Routes>
          </main>
          <footer>
            序 · AI 原生 DevOps <span>每个决定，都有来处。</span>
          </footer>
        </div>
      </div>
    </Ctx.Provider>
  );
}
function Home() {
  const { w, project, session } = useData(),
    [filter, setFilter] = useState("全部");
  if (!w) return null;
  const intents = w.intents.filter((i: Row) => i.projectId === project?.id);
  const blocked = intents.filter((i: Row) => i.control !== "ACTIVE");
  const displayed = intents.filter(
    (i: Row) =>
      filter === "全部" ||
      (filter === "待确认"
        ? ["DRAFT", "PR_OPEN"].includes(i.stage)
        : filter === "受阻"
          ? i.control !== "ACTIVE"
          : i.stage === "MERGED"),
  );
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE / 工作台"
        title={project ? `${project.name}，有序向前` : "从一个项目开始"}
        description="看清下一步，确认值得交付的改变。"
        action={
          <Space>
            {session.user.admin && (
              <Link to="/projects/new">
                <Button>新建项目</Button>
              </Link>
            )}
            {project && (
              <Link to="/intents/new">
                <Button
                  type="primary"
                  icon={<PlusOutlined aria-hidden="true" />}
                >
                  创建 Intent
                </Button>
              </Link>
            )}
          </Space>
        }
      />
      {!project ? (
        <Blank
          title="工作区准备就绪"
          description="创建项目后，登记第一个目标。方案、证据与交付将在这里连接起来。"
          link={session.user.admin ? "/projects/new" : undefined}
          button="创建第一个项目"
        />
      ) : (
        <>
          <div className="overview">
            <Card className="overview-primary">
              <span className="eyebrow">当前生产</span>
              <h2>
                {project.production?.confirmed
                  ? shortSha(project.production.actualSha)
                  : "等待生产核验"}
              </h2>
              <p>
                {project.production?.confirmed
                  ? "实际版本已确认"
                  : "由 IDE 预设逻辑报告版本，人类完成确认"}
              </p>
              <Tag>{project.environment}</Tag>
            </Card>
            <Metric
              title="进行中的 Intent"
              value={intents.filter((i: Row) => i.stage !== "MERGED").length}
              hint="每个目标独立验收"
            />
            <Metric
              title="等待人类决定"
              value={
                intents.filter((i: Row) =>
                  ["DRAFT", "PR_OPEN"].includes(i.stage),
                ).length
              }
              hint="确认目标或审查合并"
            />
            <Metric
              title="需要处理"
              value={blocked.length}
              hint="未知、失效与异常"
            />
          </div>
          {blocked.length > 0 && (
            <Alert
              className="section-gap"
              type="warning"
              message="有交付需要人类处理"
              description="先核验实际结果，再决定恢复路径。"
              showIcon
            />
          )}
          <div className="section-head">
            <h2>
              我的 Intent <span>{intents.length}</span>
            </h2>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={["全部", "待确认", "受阻", "已合并"]}
            />
          </div>
          {displayed.length ? (
            <div className="card-grid">
              {displayed.map((i: Row) => (
                <IntentCard key={i.id} row={i} />
              ))}
            </div>
          ) : (
            <Blank
              title="这里还没有 Intent"
              description="一个清晰的目标，是一次可靠交付的起点。"
              link="/intents/new"
              button="创建 Intent"
            />
          )}
        </>
      )}
    </>
  );
}
function Metric({
  title,
  value,
  hint,
}: {
  title: string;
  value: number;
  hint: string;
}) {
  return (
    <Card className="metric">
      <span>{title}</span>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>{hint}</small>
    </Card>
  );
}
function IntentCard({ row: i }: { row: Row }) {
  return (
    <Link className="card-link" to={"/intents/" + i.id}>
      <Card hoverable>
        <div className="card-top">
          <Tag>{label(i.kind)}</Tag>
          <Status value={i.control !== "ACTIVE" ? i.control : i.stage} />
        </div>
        <h3>{i.title}</h3>
        <p className="two-lines">{i.description}</p>
        <div className="card-bottom">
          <span>
            {label(i.risk)} · {shortSha(i.sourceSha)}
          </span>
          <ArrowRightOutlined aria-hidden="true" />
        </div>
      </Card>
    </Link>
  );
}
function ProjectForm() {
  const { refresh, selectProject } = useData(),
    nav = useNavigate();
  return (
    <>
      <PageTitle
        title="创建项目"
        description="建立统一的代码入口、环境和固定验收命令。"
        back="/"
      />
      <ActionForm
        title="项目基础与执行约定"
        initialValues={projectDefaults}
        button="创建项目与受保护仓库"
        onSubmit={(v) => act("project.create", v)}
        onDone={async (r) => {
          await refresh();
          selectProject(r.id);
          nav("/");
        }}
      >
        <div className="form-grid">
          <Field name="name" title="项目名称" />
          <Field name="slug" title="仓库标识" placeholder="如 ticket-service" />
          <Field name="environment" title="发布环境" />
          <Field name="testEnvironment" title="隔离验收环境" />
          <Field name="runnerId" title="验收 Runner 身份名称" />
          <Field name="toolVersion" title="固定工具版本" />
          <Field name="apiCommand" title="API 命令 ID" />
          <Field name="e2eCommand" title="E2E 命令 ID" />
          <Field name="configVersion" title="配置版本" />
          <Field name="policyVersion" title="策略版本" />
        </div>
      </ActionForm>
    </>
  );
}
function IntentForm() {
  const { project, refresh } = useData(),
    nav = useNavigate();
  if (!project) return <Blank title="请先选择项目" link="/" />;
  return (
    <>
      <PageTitle
        title="登记新的 Intent"
        description="先描述想解决的问题，再由点方案和应用方案确定执行范围。"
        back="/"
      />
      <ActionForm
        title="目标与风险"
        initialValues={{ kind: "feature", risk: "low" }}
        button="创建目标"
        onSubmit={(v) => act("intent.create", { ...v, projectId: project.id })}
        onDone={async (r) => {
          await refresh();
          nav("/intents/" + r.id);
        }}
      >
        <Field
          name="title"
          title="目标名称"
          placeholder="例如：避免重复提交产生多张工单"
        />
        <Field name="description" title="背景与预期结果" area />
        <div className="form-grid">
          <Form.Item name="kind" label="变更类型">
            <Select
              options={[
                "feature",
                "defect",
                "hotfix",
                "migration",
                "config",
                "security",
              ].map((v) => ({ value: v, label: label(v) }))}
            />
          </Form.Item>
          <Form.Item name="risk" label="风险等级">
            <Select
              options={["low", "medium", "high"].map((v) => ({
                value: v,
                label: label(v),
              }))}
            />
          </Form.Item>
        </div>
        <Field
          name="incident"
          title="生产事件编号（热修复必填）"
          required={false}
        />
      </ActionForm>
    </>
  );
}
function IntentDetail() {
  const { id } = useParams(),
    { w, refresh } = useData(),
    i = w.intents.find((r: Row) => r.id === id);
  if (!i) return <Blank title="Intent 不存在" />;
  const evidence = w.evidence.filter((e: Row) => e.subjectId === id);
  return (
    <>
      <PageTitle
        title={i.title}
        description={i.description}
        back="/"
        action={<Status value={i.control !== "ACTIVE" ? i.control : i.stage} />}
      />
      {i.agentDraft && (
        <Card title="Agent 方案候选 · 尚未采纳" className="section-gap">
          <Code value={i.agentDraft.candidate} />
          <small>
            {i.agentDraft.model} · {date(i.agentDraft.at)}
          </small>
        </Card>
      )}
      {i.reason && (
        <Alert
          className="section-gap"
          type="warning"
          message={i.reason}
          showIcon
        />
      )}
      <Card className="section-gap">
        <Steps
          current={[
            "DRAFT",
            "A_SIGNED",
            "IMPLEMENTING",
            "PR_OPEN",
            "MERGED",
          ].indexOf(i.stage)}
          items={[
            { title: "目标草稿" },
            { title: "确认工作区" },
            { title: "实现与验收" },
            { title: "PR 审查" },
            { title: "组合交付" },
          ]}
        />
      </Card>
      <div className="decision-grid">
        <div>
          <Card
            title="目标与应用方案"
            extra={<Link to={"/intents/" + id + "/plan"}>编辑草稿</Link>}
          >
            {i.plan ? (
              <>
                <h3>{i.plan.point.goal}</h3>
                <Detail
                  items={[
                    ["范围", i.plan.point.scope.join("；")],
                    ["非目标", i.plan.point.nonGoals.join("；")],
                    ["责任人", i.plan.point.owner],
                    [
                      "状态改变",
                      i.plan.application.changes
                        .map((c: any) => `${c.object} · ${c.scope}`)
                        .join("；"),
                    ],
                    ["恢复", i.plan.application.rollback],
                  ]}
                />
                <details>
                  <summary>完整方案与引用</summary>
                  <Code value={i.plan} />
                </details>
              </>
            ) : (
              <Blank
                title="还没有方案"
                description="先准备点方案与应用方案，再签发工作区。"
                link={"/intents/" + id + "/plan"}
                button="准备方案"
              />
            )}
          </Card>
          <Card
            title="验收材料"
            className="section-gap"
            extra={
              i.snapshotId && (
                <Link to={"/intents/" + id + "/materials"}>维护材料</Link>
              )
            }
          >
            {i.materials ? (
              <Detail
                items={[
                  ["说明书", i.materials.manual],
                  ["变更说明", i.materials.changelog],
                  ["接口契约", i.materials.apiContract],
                  ["数据准备", i.materials.dataPreparation],
                  ["数据清理", i.materials.dataCleanup],
                  ["偏离", i.materials.deviations],
                ]}
              />
            ) : (
              <p className="muted">
                Gate A（方案确认）后，DevOps agent 提交文档、API/E2E
                用例及数据准备/清理。
              </p>
            )}
          </Card>
          <Evidence rows={evidence} />
        </div>
        <div>
          <Card title="下一步">
            <p>签发固定目标，让 IDE 在确认范围内实现。</p>
            <Link to={"/gate/intent/" + id + "/A"}>
              <Button block type="primary" disabled={i.stage === "MERGED"}>
                审阅 Gate A（方案确认）
              </Button>
            </Link>
            <Link to={"/gate/intent/" + id + "/B"}>
              <Button
                className="section-gap"
                block
                disabled={!i.snapshotId || i.stage === "MERGED"}
              >
                审阅 Gate B（交付候选确认）
              </Button>
            </Link>
            {i.pr && i.stage !== "MERGED" && (
              <Link to={"/merge/" + id}>
                <Button block className="section-gap">
                  审查并合并 PR #{i.pr.number}
                </Button>
              </Link>
            )}
          </Card>
          <Card title="确认工作区" className="section-gap">
            <Detail
              items={[
                ["目标分支", i.targetBranch],
                ["工作分支", i.branch],
                ["基线", shortSha(i.baseSha)],
                ["当前提交", shortSha(i.sourceSha)],
                ["风险", label(i.risk)],
                ["方案修订", i.planVersion],
              ]}
            />
            {i.snapshotId && (
              <Typography.Text copyable>{i.snapshotId}</Typography.Text>
            )}
          </Card>
          <Card title="受控执行" className="section-gap">
            <ActionButton
              text="生成方案候选"
              disabled={i.stage === "MERGED"}
              action={() => act("agent.draft", { id })}
              refresh={refresh}
            />

            <ActionButton
              text="登记 API / E2E 验收"
              disabled={!i.build}
              action={() => act("tests.request", { id })}
              refresh={refresh}
            />
            <p className="muted">
              构建由 IDE 预设逻辑执行；测试由隔离 Runner
              执行，回执绑定当前提交。
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
function IntentEditor() {
  const { id, editor } = useParams(),
    { w, project, session, refresh } = useData(),
    nav = useNavigate(),
    i = w.intents.find((x: Row) => x.id === id);
  if (!i) return null;
  const isPlan = editor === "plan";
  const Editor = isPlan ? PlanEditor : MaterialsEditor;
  return (
    <>
      <PageTitle
        title={isPlan ? "编辑点方案与应用方案" : "维护交付材料"}
        description="内容会形成新的修订，相关旧批准和验收证据将失效。"
        back={"/intents/" + id}
      />
      <Editor
        initial={
          isPlan
            ? i.plan || newPlan(i.title, session.user.name, project.hotfixRefs)
            : i.materials || newMaterials
        }
        onSave={async (v) => {
          await act(isPlan ? "plan.save" : "materials.save", {
            id,
            [isPlan ? "plan" : "materials"]: v,
          });
          await refresh();
          nav("/intents/" + id);
        }}
      />
    </>
  );
}
function Evidence({ rows }: { rows: Row[] }) {
  return (
    <Card title="执行证据" className="section-gap">
      {!rows.length ? (
        <p className="muted">尚无执行证据。生成用例不代表执行通过。</p>
      ) : (
        <div className="evidence-list">
          {rows.map((e) => (
            <details key={e.id}>
              <summary>
                <strong>{e.kind?.toUpperCase()}</strong>
                <Status value={e.status} />
                <span>{date(e.createdAt)}</span>
              </summary>
              <Code value={e.log || e} />
              <small>{e.operationId}</small>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}
function GatePage() {
  const { kind, id, gate } = useParams(),
    { refresh } = useData(),
    nav = useNavigate(),
    [preview, setPreview] = useState<any>(),
    [error, setError] = useState(""),
    [step, setStep] = useState(0);
  const load = () =>
    api(`/preview/${kind}/${id}/${gate}`)
      .then(setPreview)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [id, gate]);
  const back = kind === "delivery" ? "/deliveries/" + id : "/intents/" + id;
  const titles: Record<string, string> = {
    A: "方案确认：签发目标并创建工作区",
    B: "交付候选确认：签发交付并创建 PR",
    C: "发布确认：签发发布输入",
  };
  return (
    <>
      <PageTitle
        title={"Gate " + gate + " · " + titles[gate!]}
        description="先审缺口与差异，再确认固定版本，最后记录你的决定。每道 Gate 都会记录固定对象和审查理由。"
        back={back}
      />
      {error && <Alert type="error" message={error} />}
      {!preview ? (
        <Spin />
      ) : (
        <>
          <Card className="section-gap">
            <Steps
              current={step}
              items={[
                { title: "差异与缺口" },
                { title: "固定对象" },
                { title: "签发决定" },
              ]}
            />
          </Card>
          {step === 0 && (
            <div className="decision-grid">
              <div>
                <Card title="真实代码差异">
                  <Code
                    value={
                      preview.diff || "此阶段确认目标与状态改变，不审批实现。"
                    }
                  />
                </Card>
                <Evidence rows={preview.evidence} />
              </div>
              <Card title="签发前检查">
                {preview.gaps.length ? (
                  <Alert
                    type="warning"
                    message="当前尚不可签发"
                    description={
                      <ul>
                        {preview.gaps.map((g: string) => (
                          <li key={g}>{g}</li>
                        ))}
                      </ul>
                    }
                  />
                ) : (
                  <Alert
                    type="success"
                    message="程序检查无缺口，等待人类审查"
                  />
                )}
                <p className="muted">
                  提交、材料或配置变化后，页面中的旧确认将被拒绝。
                </p>
              </Card>
            </div>
          )}
          {step === 1 && (
            <Card title="本次签发的固定内容">
              <Detail
                items={[
                  ["环境", preview.project.environment],
                  [
                    "提交",
                    preview.subject.sourceSha || preview.subject.baseSha,
                  ],
                  ["制品", preview.subject.build?.artifactDigest],
                  ["配置", preview.project.configVersion],
                  ["输入指纹", preview.fingerprint],
                ]}
              />
              <Code
                value={
                  gate === "C" ? preview.subject.system : preview.subject.plan
                }
              />
            </Card>
          )}
          {step === 2 && (
            <ActionForm
              title={
                "记录 Gate " +
                gate +
                "（" +
                titles[gate!].split("：")[0] +
                "）决定"
              }
              button={titles[gate!]}
              disabled={preview.gaps.length > 0}
              onSubmit={async (v) => {
                const r = await act(
                  v.countersign
                    ? "gate.c.review"
                    : "gate." + gate!.toLowerCase(),
                  {
                    id,
                    fingerprint: preview.fingerprint,
                    reason: v.reason,
                  },
                );
                await refresh();
                nav(back);
                return r;
              }}
            >
              <Alert
                type="info"
                message={
                  gate === "C"
                    ? "本次只签发发布输入。IDE 预设逻辑发布后，还需实际版本回执。"
                    : "你的账号和理由将与固定指纹一起写入审计。"
                }
              />
              {gate === "C" && (
                <Form.Item name="countersign" valuePropName="checked">
                  <Checkbox>
                    本次作为审查人会签（高风险需另一位负责人最终签发）
                  </Checkbox>
                </Form.Item>
              )}
              <Field name="reason" title="审查结论与理由" area />
              <Form.Item
                name="ack"
                valuePropName="checked"
                rules={[
                  {
                    validator: (_, v) =>
                      v
                        ? Promise.resolve()
                        : Promise.reject(new Error("请确认已审查固定对象")),
                  },
                ]}
              >
                <Checkbox>我已审查当前目标、证据、影响范围和恢复方式</Checkbox>
              </Form.Item>
            </ActionForm>
          )}
          <div className="gate-nav">
            <Button disabled={!step} onClick={() => setStep(step - 1)}>
              上一步
            </Button>
            {step < 2 && (
              <Button type="primary" onClick={() => setStep(step + 1)}>
                {step === 0 ? "核对固定对象" : "填写签发决定"}{" "}
                <ArrowRightOutlined aria-hidden="true" />
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
function Deliveries() {
  const { w, project } = useData();
  const prs = w.intents.filter(
      (i: Row) => i.projectId === project?.id && i.pr && i.stage !== "MERGED",
    ),
    deliveries = w.deliveries.filter((i: Row) => i.projectId === project?.id);
  return (
    <>
      <PageTitle
        title="从 PR 到组合交付"
        description="每次合并改变目标提交。最终组合需要重新构建和验收。"
      />
      <h2>待合并 PR</h2>
      {prs.length ? (
        <div className="card-grid">
          {prs.map((i: Row) => (
            <IntentCard key={i.id} row={i} />
          ))}
        </div>
      ) : (
        <Blank
          title="暂无待合并 PR"
          description="Gate B（交付候选确认）签发通过后，程序自动创建真实 PR。"
        />
      )}
      <h2 className="section-gap">组合候选</h2>
      {deliveries.length ? (
        <div className="card-grid">
          {[...deliveries].reverse().map((d: Row) => (
            <Link key={d.id} className="card-link" to={"/deliveries/" + d.id}>
              <Card hoverable>
                <div className="card-top">
                  <Tag>{d.targetBranch}</Tag>
                  <Status value={d.stage} />
                </div>
                <h3>组合 {shortSha(d.sourceSha)}</h3>
                <p>
                  {d.intentIds.length} 项应用方案 · {date(d.createdAt)}
                </p>
                {d.reason && <p>{d.reason}</p>}
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Blank
          title="还没有组合交付"
          description="在 DevOps 中合并第一个 PR 后自动生成。"
        />
      )}
    </>
  );
}
function DeliveryDetail() {
  const { id } = useParams(),
    { w, refresh } = useData(),
    d = w.deliveries.find((x: Row) => x.id === id);
  if (!d) return null;
  return (
    <>
      <PageTitle
        title={"组合交付 · " + shortSha(d.sourceSha)}
        description="以最终合并提交为准，审阅完整发布范围与实际结果。"
        back="/deliveries"
        action={<Status value={d.control === "ACTIVE" ? d.stage : d.control} />}
      />
      {d.reason && (
        <Alert type="warning" message={d.reason} className="section-gap" />
      )}
      <div className="decision-grid">
        <div>
          <Card title="完整交付范围">
            {d.intentIds.map((i: string) => {
              const row = w.intents.find((x: Row) => x.id === i);
              return (
                <p key={i}>
                  <Link to={"/intents/" + i}>{row?.title || i}</Link>
                </p>
              );
            })}
            <Detail
              items={[
                ["来源提交", d.sourceSha],
                ["实际生产基线", d.baseSha],
                ["目标分支", d.targetBranch],
                ["制品", d.build?.artifactDigest],
              ]}
            />
          </Card>
          <Evidence rows={w.evidence.filter((e: Row) => e.subjectId === id)} />
          <Card
            title="系统方案"
            extra={
              <Link to={"/deliveries/" + id + "/system"}>编辑系统方案</Link>
            }
            className="section-gap"
          >
            {d.system ? (
              <Code value={d.system} />
            ) : (
              <p>完成组合构建与验收后填写。</p>
            )}
          </Card>
          {d.receipt && (
            <Card title="实际发布回执" className="section-gap">
              <Code value={d.receipt} />
            </Card>
          )}
        </div>
        <Card title="交付决策">
          <Link to={"/gate/delivery/" + id + "/C"}>
            <Button block type="primary" disabled={d.stage === "CLOSED"}>
              审阅 Gate C（发布确认）
            </Button>
          </Link>
          <ActionButton
            text="登记组合 API / E2E"
            disabled={!d.build}
            action={() => act("tests.request", { id })}
            refresh={refresh}
          />
          <p className="muted">
            签发后由 IDE agent 请求发布，IDE
            预设逻辑执行，平台按实际回执核验关闭。
          </p>
        </Card>
      </div>
    </>
  );
}
function SystemEditor() {
  const { id } = useParams(),
    { w, refresh } = useData(),
    nav = useNavigate(),
    d = w.deliveries.find((x: Row) => x.id === id),
    p = w.projects.find((x: Row) => x.id === d?.projectId);
  if (!d) return null;
  return (
    <>
      <PageTitle title="编辑系统方案" back={"/deliveries/" + id} />
      <SystemEditorForm
        initial={
          d.system || {
            sourceSha: d.sourceSha,
            artifactDigest: d.build?.artifactDigest || "",
            configVersion: p.configVersion,
            environment: p.environment,
            applications: d.intentIds,
            sequence: [],
            migrations: ["无"],
            healthChecks: [],
            rollback: "",
            scope: [],
          }
        }
        onSave={async (system) => {
          await act("system.save", { id, system });
          await refresh();
          nav("/deliveries/" + id);
        }}
      />
    </>
  );
}
function MergePage() {
  const { id } = useParams(),
    { w, refresh } = useData(),
    nav = useNavigate(),
    i = w.intents.find((x: Row) => x.id === id),
    [preview, setPreview] = useState<any>();
  useEffect(() => {
    api(`/preview/intent/${id}/B`)
      .then(setPreview)
      .catch(() => {});
  }, [id]);
  if (!i || !preview) return <Spin />;
  return (
    <>
      <PageTitle
        title={"合并 PR #" + i.pr?.number}
        description="每次确认一个 PR。合并后，其他 PR 需要检查新的目标版本。"
        back={"/intents/" + id}
      />
      <Card title="将要进入目标分支的改变">
        <Detail
          items={[
            ["Intent", i.title],
            ["来源", preview.subject.sourceSha],
            ["目标分支", i.targetBranch],
            ["目标提交", preview.subject.targetSha],
          ]}
        />
        <Code value={preview.diff} />
      </Card>
      <ActionForm
        title="人工合并确认"
        button="确认合并并创建组合候选"
        disabled={
          preview.gaps.length > 0 || preview.subject.pr?.status !== "OPEN"
        }
        onSubmit={(v) =>
          act("merge", {
            ids: [id],
            targetSha: preview.subject.targetSha,
            reason: v.reason,
          })
        }
        onDone={async (d) => {
          await refresh();
          nav(d.intentIds ? "/deliveries/" + d.id : "/");
        }}
      >
        <Field name="reason" title="合并理由" area />
        {preview.gaps.length > 0 && (
          <Alert type="warning" message={preview.gaps.join("；")} />
        )}
      </ActionForm>
    </>
  );
}
function ActionButton({
  text,
  action,
  refresh,
  disabled = false,
}: {
  text: string;
  action: () => Promise<any>;
  refresh: () => Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        className="section-gap"
        block
        loading={busy}
        disabled={disabled}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await action();
            await refresh();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {text}
      </Button>
      {error && <Alert type="error" className="section-gap" message={error} />}
    </>
  );
}
function Operations() {
  const { w, project } = useData(),
    ops = w.operations.filter((o: Row) => o.projectId === project?.id);
  return (
    <>
      <PageTitle
        title="发布与运行"
        description="执行有身份、结果有来源。未知结果先对账，再恢复。"
      />
      {ops.length ? (
        <div className="card-grid">
          {[...ops].reverse().map((o: Row) => (
            <Link key={o.id} className="card-link" to={"/operations/" + o.id}>
              <Card hoverable>
                <div className="card-top">
                  <strong>{o.kind}</strong>
                  <Status value={o.status} />
                </div>
                <p>{o.reason || date(o.createdAt)}</p>
                <small>{o.id}</small>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Blank
          title="还没有执行操作"
          description="构建、验收、Git 变更和发布请求会显示在这里。"
        />
      )}
      {w.syncTasks
        .filter((t: Row) => t.projectId === project?.id)
        .map((t: Row) => (
          <Card key={t.id} title="热修复同步" className="section-gap">
            <Status value={t.status} />
            <p>生产提交 {shortSha(t.productionSha)}</p>
            <Link to={"/intents/" + t.intentId}>打开同步 Intent</Link>
          </Card>
        ))}
    </>
  );
}
function OperationDetail() {
  const { id } = useParams(),
    { w, refresh } = useData(),
    o = w.operations.find((x: Row) => x.id === id);
  if (!o) return null;
  return (
    <>
      <PageTitle
        title={"操作 · " + o.kind}
        description={o.id}
        back="/operations"
        action={<Status value={o.status} />}
      />
      <Card title="执行输入与结果">
        <Code value={o} />
      </Card>
      {o.status === "UNKNOWN" && (
        <ActionForm
          title="核验实际结果"
          button="查询 Git 实际状态"
          onSubmit={() => act("operation.reconcile", { id })}
          onDone={refresh}
        >
          <Alert
            type="warning"
            message="Git 操作由程序查询；构建、测试和发布需原执行身份提交同一操作 ID 的签名回执。"
          />
        </ActionForm>
      )}
      <ActionForm
        title="人工恢复"
        button="核验后恢复，重新验收"
        onSubmit={(v) => act("recovery", { id: o.subjectId, reason: v.reason })}
        onDone={refresh}
      >
        <Field name="reason" title="对账结论与恢复理由" area />
      </ActionForm>
    </>
  );
}
function Settings() {
  const { w, project, refresh, session } = useData();
  return (
    <>
      <PageTitle
        title="项目与授权"
        description="统一人类账号，按项目委托明确的能力。"
        action={
          <Space>
            {session.user.admin && (
              <Link to="/users/new">
                <Button>创建统一账号</Button>
              </Link>
            )}
            {project && (
              <Link to="/credentials/new">
                <Button type="primary">授权 IDE / 执行端</Button>
              </Link>
            )}
          </Space>
        }
      />
      {project && (
        <>
          <Card title={project.name}>
            <Detail
              items={[
                [
                  "Git 唯一入口",
                  <Typography.Text copyable>
                    {location.origin + "/git/" + project.slug + ".git"}
                  </Typography.Text>,
                ],
                ["环境", project.environment],
                ["验收环境", project.testEnvironment],
                [
                  "当前生产",
                  project.production?.confirmed
                    ? shortSha(project.production.actualSha)
                    : "尚未核验",
                ],
              ]}
            />
            {project.production && !project.production.confirmed && (
              <ActionButton
                text="确认已报告的生产版本"
                action={() =>
                  act("production.confirm", {
                    projectId: project.id,
                    fingerprint: project.production.fingerprint,
                  })
                }
                refresh={refresh}
              />
            )}
          </Card>
          <h2 className="section-gap">有效委托与历史授权</h2>
          <div className="card-grid">
            {w.credentials
              .filter((c: Row) => c.projectId === project.id)
              .map((c: Row) => (
                <Card key={c.id} title={c.name}>
                  <Tag>{label(c.role)}</Tag>
                  <p>{c.revoked ? "已撤销" : "到期 " + date(c.expiresAt)}</p>
                  {!c.revoked && (
                    <ActionButton
                      text="撤销凭证"
                      action={() => act("credential.revoke", { id: c.id })}
                      refresh={refresh}
                    />
                  )}
                </Card>
              ))}
          </div>
          <ActionForm
            title="项目成员角色"
            onSubmit={(v) =>
              act("project.member", { projectId: project.id, ...v })
            }
            onDone={refresh}
          >
            <Form.Item
              name="userId"
              label="统一账号"
              rules={[{ required: true }]}
            >
              <Select
                options={w.users.map((u: Row) => ({
                  label: u.username,
                  value: u.id,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="role"
              label="项目角色"
              rules={[{ required: true }]}
            >
              <Select
                options={["owner", "reviewer", "member", "observer"].map(
                  (v) => ({ value: v, label: label(v) }),
                )}
              />
            </Form.Item>
          </ActionForm>
          <details className="section-gap">
            <summary>配置版本与固定执行策略</summary>
            <JsonEditor
              title="项目配置"
              initial={Object.fromEntries(
                Object.keys(projectDefaults).map((k) => [k, project[k]]),
              )}
              onSave={async (settings) => {
                await act("project.update", {
                  projectId: project.id,
                  settings,
                });
                await refresh();
              }}
            />
          </details>
        </>
      )}
    </>
  );
}
function CredentialForm() {
  const { project, refresh } = useData(),
    [result, setResult] = useState<any>(),
    [role, setRole] = useState("human");
  if (!project) return <Blank title="请先选择项目" />;
  return (
    <>
      <PageTitle
        title="授权 IDE 与执行端"
        description="凭证有效期一小时，关联当前人类账号和选定项目。"
        back="/settings"
      />
      {result ? (
        <Card title="凭证已签发，仅展示一次">
          <Alert
            type="warning"
            message="将凭证保存到 IDE 凭证管理器，或执行端的密钥存储。不要写进 Git。"
          />
          <p>
            <Typography.Text copyable>{result.token}</Typography.Text>
          </p>
          <Detail
            items={[
              ["身份", label(result.role)],
              ["到期", date(result.expiresAt)],
            ]}
          />
          <Link to="/settings">
            <Button>返回授权管理</Button>
          </Link>
        </Card>
      ) : (
        <ActionForm
          title="授权范围"
          initialValues={{ role: "human" }}
          button="生成短时凭证"
          onSubmit={(v) =>
            act("credential.create", { projectId: project.id, ...v, hours: 1 })
          }
          onDone={async (r) => {
            setResult(r);
            await refresh();
          }}
        >
          <Field
            name="name"
            title="设备或执行端名称"
            placeholder="Runner 名称必须匹配项目配置"
          />
          <Form.Item name="role" label="能力身份">
            <Select
              onChange={setRole}
              options={[
                "human",
                "devops_agent",
                "ide_agent",
                "ide_control",
                "runner",
              ].map((v) => ({ value: v, label: label(v) }))}
            />
          </Form.Item>
          <Field name="branch" title="限定工作分支（可选）" required={false} />
          {["ide_control", "runner"].includes(role) && (
            <Field name="publicKey" title="执行端 Ed25519 公钥（PEM）" area />
          )}
        </ActionForm>
      )}
    </>
  );
}
function UserForm() {
  const { refresh } = useData(),
    nav = useNavigate();
  return (
    <>
      <PageTitle
        title="创建统一人类账号"
        description="账号创建于 Gitea。用户使用用户名密码登录，平台不支持 Passkey。"
        back="/settings"
      />
      <ActionForm
        title="账号信息"
        button="创建账号"
        onSubmit={(v) => act("user.create", v)}
        onDone={async () => {
          await refresh();
          nav("/settings");
        }}
      >
        <Field name="username" title="用户名" />
        <Field name="email" title="邮箱" />
        <Form.Item
          name="password"
          label="初始密码"
          rules={[{ required: true, min: 8 }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </ActionForm>
    </>
  );
}
function Audit() {
  const [items, setItems] = useState<any[]>(),
    [error, setError] = useState("");
  useEffect(() => {
    api("/audit")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageTitle
        title="每个决定，都有来处"
        description="身份、委托、动作与固定版本组成连续的审计轨迹。"
      />
      {error && <Alert type="error" message={error} />}
      <Card>
        {items ? (
          <Timeline
            items={items.map((e) => ({
              color: e.action.endsWith(".denied") ? "red" : "purple",
              children: (
                <>
                  <strong>{e.action}</strong>
                  <p className="muted">
                    {e.actor} · {date(e.at)}
                  </p>
                  <details>
                    <summary>关联记录</summary>
                    <Code value={e.details} />
                    <small>{e.hash}</small>
                  </details>
                </>
              ),
            }))}
          />
        ) : (
          <Spin />
        )}
      </Card>
    </>
  );
}
function Ops() {
  const [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const load = async () => {
    try {
      setData(await api("/ops"));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <PageTitle
        title="系统运维"
        description="一个容器，两个持久化卷。备份期间暂停入口，形成完整一致点。"
        action={
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={load}>
            刷新
          </Button>
        }
      />
      {error && <Alert type="error" message={error} />}
      {data ? (
        <>
          <div className="overview">
            <Card className="overview-primary">
              <span className="eyebrow">平台状态</span>
              <h2>{label(data.phase)}</h2>
              <p>{data.message || "DevOps · Gitea · MySQL"}</p>
            </Card>
            <Card title="下次定时备份">
              <h3>{date(data.schedule?.nextAt)}</h3>
              <p>默认每日 03:00 · Asia/Shanghai</p>
            </Card>
            <Card title="持久化">
              <h3>/data → /backup</h3>
              <p>7 个日备份 · 4 个周备份 · 升级前保留</p>
            </Card>
          </div>
          <ActionForm
            title="立即创建备份"
            button="进入维护并创建全量备份"
            onSubmit={() => api("/ops/backup", {})}
          >
            <Alert
              type="info"
              message="程序排空请求并停止内部写入后归档，完成后自动恢复服务。维护期间页面暂不可访问。"
            />
          </ActionForm>
          <ActionForm
            title="备份计划"
            initialValues={{
              time: data.schedule?.time || "03:00",
              zone: data.schedule?.zone || "Asia/Shanghai",
            }}
            button="更新计划"
            onSubmit={(v) => api("/ops/schedule", v)}
            onDone={load}
          >
            <div className="form-grid">
              <Field name="time" title="每日时间（HH:mm）" />
              <Field name="zone" title="IANA 时区" />
            </div>
          </ActionForm>
          {data.lastBackup?.status === "FAILED" && (
            <Alert
              type="error"
              className="section-gap"
              message="最近备份失败"
              description={data.lastBackup.message}
            />
          )}
          {data.restore && (
            <Card title="最近恢复验证" className="section-gap">
              <Code value={data.restore} />
            </Card>
          )}
          <h2 className="section-gap">可用恢复点</h2>
          {data.backups?.length ? (
            <div className="card-grid">
              {data.backups.map((b: any) => (
                <Card key={b.id} title={date(b.cutoff || b.createdAt)}>
                  <Status value={b.status} />
                  <p>
                    {b.reason} · {(b.bytes / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <Typography.Text copyable>{b.id}</Typography.Text>
                  <p className="muted">
                    归档校验完成；恢复演练需查看独立报告。
                  </p>
                </Card>
              ))}
            </div>
          ) : (
            <Blank title="暂无已完成归档" />
          )}
          <Card title="恢复指引" className="section-gap">
            <p>
              使用相同版本镜像与一个全新空 data 卷，挂载原 backup
              卷，执行固定恢复命令。恢复后旧会话和委托全部撤销，待执行操作进入对账。
            </p>
            <Code value="devopsctl restore <backupId>" />
            <p>
              完整宿主机命令见仓库使用手册。backup 和 data
              若位于同一主机，仍需将归档复制到异地存储。
            </p>
          </Card>
        </>
      ) : (
        <Spin />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#7047eb",
          borderRadius: 12,
          colorText: "#262239",
          colorTextSecondary: "#756d86",
          colorBgLayout: "#f6f5fa",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
        },
        components: {
          Button: { controlHeight: 38 },
          Card: { paddingLG: 24 },
          Input: { controlHeight: 40 },
        },
      }}
    >
      <App>
        <BrowserRouter>
          <Application />
        </BrowserRouter>
      </App>
    </ConfigProvider>
  </React.StrictMode>,
);
