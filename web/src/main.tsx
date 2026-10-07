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
  Timeline,
  Typography,
  Segmented,
  Radio,
  Popconfirm,
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
  ActionForm,
  Field,
  Detail,
} from "./components";
import "./style.css";
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
            让每一次版本，
            <br />
            都有据可循。
          </h1>
          <p>
            从需求到每一次变更。
            <br />
            IDE 专注实现，DevOps 管理需求与版本。
          </p>
          <div className="orbit">
            <div>需求</div>
            <i />
            <div>变更</div>
            <i />
            <div>版本</div>
          </div>
          <small>AI NATIVE DEVELOPMENT · HUMAN IN CONTROL</small>
        </div>
        <div className="login-panel">
          <Tag color="purple">一个账号 · 同一工作区</Tag>
          <h2>进入你的版本工作台</h2>
          <p>
            使用统一账号和用户名密码登录。IDE 的短时 Git 凭证也由此账号授权。
          </p>
          {error && <Alert type="error" message={error} />}
          <Button type="primary" size="large" block href="/api/auth/login">
            用户名密码登录 <ArrowRightOutlined aria-hidden="true" />
          </Button>
          <p className="login-help">
            内置管理员账号为 <code>admin</code>，初始密码为 <code>admin</code>。
            每次使用默认密码登录后会提示修改密码，也可以暂时忽略。
          </p>
          <div className="login-note">
            <SafetyCertificateOutlined aria-hidden="true" />{" "}
            所有分支、合并和标签均有审计记录
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
              <AppstoreOutlined aria-hidden="true" /> 需求
            </NavLink>
            <NavLink to="/branches">
              <BranchesOutlined aria-hidden="true" /> 分支与合并
            </NavLink>
            <NavLink to="/versions">
              <RocketOutlined aria-hidden="true" /> 版本
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
            {session.user.admin && (
              <>
                <NavLink to="/skills">
                  <CodeOutlined aria-hidden="true" /> 技能库
                </NavLink>
                <NavLink to="/templates">
                  <ReadOutlined aria-hidden="true" /> 项目模板
                </NavLink>
              </>
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
              <span className="live-dot" /> 需求清晰 · 版本可追溯
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
              <Route path="/skills" element={<Skills />} />
              <Route path="/skills/new" element={<SkillForm />} />
              <Route path="/skills/:id" element={<SkillForm />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/templates/new" element={<TemplateForm />} />
              <Route path="/templates/:id" element={<TemplateForm />} />
              <Route path="/requirements/new" element={<RequirementForm />} />
              <Route path="/requirements/:id" element={<RequirementForm />} />
              <Route path="/branches" element={<Branches />} />
              <Route path="/branches/new" element={<BranchForm />} />
              <Route path="/branches/:id/delete" element={<BranchDelete />} />
              <Route path="/pulls/new/:id" element={<PullForm />} />
              <Route path="/pulls/:id" element={<PullDetail />} />
              <Route path="/versions" element={<Versions />} />
              <Route path="/versions/new" element={<VersionForm />} />
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
const options = (values: string[]) =>
  values.map((value) => ({ value, label: label(value) }));
const canWrite = (project: Row, session: any) =>
  project?.members[session.user.id] &&
  project.members[session.user.id] !== "observer";
function NoProject() {
  return (
    <Blank
      title="先建立一个项目"
      description="创建空仓库，或从压缩包导入已有项目。"
      link="/projects/new"
      button="创建或导入项目"
    />
  );
}
function Home() {
  const { w, project, session } = useData(),
    [filter, setFilter] = useState("ALL"),
    [search, setSearch] = useState("");
  const rows: Row[] =
    w?.requirements.filter((r: Row) => r.projectId === project?.id) || [];
  return (
    <>
      <PageTitle
        title="需求"
        description="记录要解决的问题，让 IDE Agent 接着完成实现、测试与发布。"
        action={
          <Space>
            <Link to="/projects/new">
              <Button>创建或导入项目</Button>
            </Link>
            {project && canWrite(project, session) && (
              <Link to="/requirements/new">
                <Button type="primary">新建需求</Button>
              </Link>
            )}
          </Space>
        }
      />
      {!project ? (
        <NoProject />
      ) : (
        <>
          <div className="overview">
            <Card className="overview-primary">
              <span className="eyebrow">当前项目</span>
              <h2>{project.name}</h2>
              <p>每一项需求，都可以关联分支和版本。</p>
            </Card>
            <Card title="进行中">
              <h2>{rows.filter((r) => r.status === "IN_PROGRESS").length}</h2>
            </Card>
            <Card title="已完成">
              <h2>{rows.filter((r) => r.status === "DONE").length}</h2>
            </Card>
          </div>
          <div className="list-tools">
            <Segmented
              value={filter}
              onChange={(v) => setFilter(String(v))}
              options={[
                { value: "ALL", label: "全部" },
                ...options(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]),
              ]}
            />
            <Input.Search
              aria-label="搜索需求"
              placeholder="搜索需求"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 260 }}
            />
          </div>
          <div className="card-grid">
            {rows
              .filter(
                (r) =>
                  (filter === "ALL" || r.status === filter) &&
                  r.title.includes(search),
              )
              .map((r) => (
                <Link key={r.id} to={"/requirements/" + r.id}>
                  <Card hoverable title={r.title}>
                    <Space>
                      <Status value={r.status} />
                      <Tag>{label(r.kind)}</Tag>
                      <Tag>优先级：{label(r.priority)}</Tag>
                    </Space>
                    <p className="card-excerpt">
                      {r.description || "尚未填写说明"}
                    </p>
                    <small className="muted">更新于 {date(r.updatedAt)}</small>
                  </Card>
                </Link>
              ))}
          </div>
          {rows.length === 0 && (
            <Blank
              title="还没有需求"
              description="先写清目标与预期结果，再交给 IDE 开始工作。"
            />
          )}
        </>
      )}
    </>
  );
}
function Skills() {
  const { w, refresh, session } = useData();
  if (!session.user.admin)
    return <Blank title="没有权限" description="技能库由平台管理员统一维护。" link="/" button="返回工作台" />;
  return (
    <>
      <PageTitle
        title="技能库"
        description="维护可复用的项目技能包，模板会把选中的技能复制到项目 skill 文件夹。"
        action={
          <Link to="/skills/new">
            <Button type="primary" icon={<PlusOutlined aria-hidden="true" />}>
              新建技能
            </Button>
          </Link>
        }
      />
      <div className="card-grid">
        {w.skills.map((skill: Row) => (
          <Card key={skill.id} title={skill.name} extra={<Tag color="purple">{skill.slug}</Tag>}>
            <p>{skill.description || "暂无说明"}</p>
            <p className="muted">修订 {skill.revision} · 必须包含 SKILL.md</p>
            <Space>
              <Link to={`/skills/${skill.id}`}><Button>编辑</Button></Link>
              <Popconfirm
                title="删除这个技能？"
                description="已被模板使用的技能不能删除。"
                onConfirm={async () => { await act("skill.delete", { id: skill.id }); await refresh(); }}
              >
                <Button danger>删除</Button>
              </Popconfirm>
            </Space>
          </Card>
        ))}
      </div>
      {!w.skills.length && <Blank title="技能库为空" description="先上传一个包含 SKILL.md 的技能包。" link="/skills/new" button="新建技能" />}
    </>
  );
}
function SkillForm() {
  const { id } = useParams(),
    { w, refresh, session } = useData(),
    nav = useNavigate(),
    [file, setFile] = useState<File>();
  const row = w.skills.find((skill: Row) => skill.id === id);
  if (!session.user.admin)
    return <Blank title="没有权限" description="技能库由平台管理员统一维护。" link="/" button="返回工作台" />;
  if (id && !row) return <Blank title="技能不存在" link="/skills" button="返回技能库" />;
  return (
    <>
      <PageTitle
        title={id ? "编辑技能" : "新建技能"}
        description="技能包是可复用的说明、规范和辅助文件，平台不会执行其中的代码。"
        back="/skills"
      />
      <ActionForm
        key={id || "new-skill"}
        title="技能信息"
        button={id ? "保存技能" : "上传技能"}
        initialValues={row || { description: "" }}
        onSubmit={async (v) => {
          const body: any = { ...v };
          if (id) {
            body.id = id;
            body.revision = row.revision;
          }
          if (file) {
            if (file.size > 8 * 1024 * 1024) throw Error("技能包不能超过 8 MiB");
            body.archiveName = file.name;
            body.archiveBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(",")[1]);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
          } else if (!id) throw Error("请选择技能压缩包");
          return act(id ? "skill.update" : "skill.create", body);
        }}
        onDone={async () => { await refresh(); nav("/skills"); }}
      >
        <Field name="name" title="技能名称" placeholder="例如：Node API 规范" />
        <Field name="slug" title="技能标识（选填）" required={false} placeholder="留空自动生成" />
        <Field name="description" title="技能说明" area required={false} placeholder="说明适用场景和边界" />
        <Form.Item label={id ? "替换技能包（选填）" : "技能压缩包"} required={!id}>
          <input aria-label="技能压缩包" type="file" onChange={(e) => setFile(e.target.files?.[0])} />
          <p className="muted">文件后缀不限，内容须包含根 SKILL.md；最多 8 MiB。</p>
        </Form.Item>
      </ActionForm>
    </>
  );
}
function Templates() {
  const { w, refresh, session } = useData();
  if (!session.user.admin)
    return <Blank title="没有权限" description="项目模板由平台管理员统一维护。" link="/" button="返回工作台" />;
  return (
    <>
      <PageTitle
        title="项目模板"
        description="模板定义初始 agent.md 和项目要携带的技能清单。"
        action={<Link to="/templates/new"><Button type="primary" icon={<PlusOutlined aria-hidden="true" />}>新建模板</Button></Link>}
      />
      <div className="card-grid">
        {w.templates.map((template: Row) => (
          <Card key={template.id} title={template.name} extra={template.system ? <Tag>系统</Tag> : <Tag color="purple">{template.slug}</Tag>}>
            <p>{template.description || "项目初始协作约定"}</p>
            <Space wrap>{template.skillIds.map((id: string) => <Tag key={id}>{w.skills.find((skill: Row) => skill.id === id)?.name || id}</Tag>)}</Space>
            <p className="muted">{template.skillIds.length} 个技能 · 修订 {template.revision}</p>
            {!template.system && <Space><Link to={`/templates/${template.id}`}><Button>编辑</Button></Link><Popconfirm title="删除这个模板？" description="已用于项目的模板不能删除。" onConfirm={async () => { await act("template.delete", { id: template.id }); await refresh(); }}><Button danger>删除</Button></Popconfirm></Space>}
          </Card>
        ))}
      </div>
    </>
  );
}
function TemplateForm() {
  const { id } = useParams(),
    { w, refresh, session } = useData(),
    nav = useNavigate(),
    row = w.templates.find((template: Row) => template.id === id);
  if (!session.user.admin)
    return <Blank title="没有权限" description="项目模板由平台管理员统一维护。" link="/" button="返回工作台" />;
  if (row?.system) return <Blank title="系统模板不可编辑" description="可以复制系统模板的内容创建自己的项目模板。" link="/templates" button="返回模板" />;
  if (id && !row) return <Blank title="模板不存在" link="/templates" button="返回模板" />;
  return (
    <>
      <PageTitle title={id ? "编辑项目模板" : "新建项目模板"} description="每个模板必须有 agent.md，并明确项目初始携带的技能清单。" back="/templates" />
      <ActionForm
        key={id || "new-template"}
        title="模板内容"
        button={id ? "保存模板" : "创建模板"}
        initialValues={row || { agentMd: "# 项目协作约定\n", skillIds: [] }}
        onSubmit={(v) => act(id ? "template.update" : "template.create", { ...v, ...(id ? { id, revision: row.revision } : {}) })}
        onDone={async () => { await refresh(); nav("/templates"); }}
      >
        <Field name="name" title="模板名称" placeholder="例如：Node 服务" />
        <Field name="slug" title="模板标识（选填）" required={false} placeholder="留空自动生成" />
        <Form.Item name="skillIds" label="项目技能清单">
          <Select mode="multiple" placeholder="选择要复制到 skill 文件夹的技能" options={w.skills.map((skill: Row) => ({ value: skill.id, label: `${skill.name} · ${skill.slug}` }))} />
        </Form.Item>
        <Form.Item name="agentMd" label="agent.md" rules={[{ required: true, message: "请填写 agent.md" }]}>
          <Input.TextArea rows={14} placeholder="填写人类、DevOps Agent 与 IDE Agent 的协作约定" />
        </Form.Item>
        <p className="muted">创建项目时会把 agent.md、skill/manifest.json 和选中的 skill/&lt;技能标识&gt;/ 文件复制到初始 Git 提交。</p>
      </ActionForm>
    </>
  );
}
function ProjectForm() {
  const { refresh, selectProject, w } = useData(),
    nav = useNavigate(),
    [mode, setMode] = useState("create"),
    [file, setFile] = useState<File>();
  return (
    <>
      <PageTitle
        title="创建或导入项目"
        description="从一个名字开始，也可以保留现有项目的全部源码。"
        back="/"
      />
      <Segmented
        className="section-gap"
        value={mode}
        onChange={(v) => setMode(String(v))}
        options={[
          { label: "创建空项目", value: "create" },
          { label: "导入压缩包", value: "import" },
        ]}
      />
      <ActionForm
        key={mode}
        title={mode === "import" ? "导入已有项目" : "项目基本信息"}
        button={mode === "import" ? "导入项目" : "创建项目"}
        initialValues={mode === "create" ? { templateId: "template_default" } : undefined}
        onSubmit={async (v) => {
          const body: any = {
            name: v.name,
            ...(v.slug ? { slug: v.slug } : {}),
            ...(mode === "create" && v.templateId ? { templateId: v.templateId } : {}),
          };
          if (mode === "import") {
            if (!file) throw Error("请选择压缩包");
            if (file.size > 32 * 1024 * 1024)
              throw Error("压缩包不能超过 32 MiB");
            body.archiveName = file.name;
            body.archiveBase64 = await new Promise<string>(
              (resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              },
            );
          }
          return act(
            mode === "import" ? "project.import" : "project.create",
            body,
          );
        }}
        onDone={async (p) => {
          await refresh();
          selectProject(p.id);
          nav("/settings");
        }}
      >
        <Field name="name" title="项目名称" placeholder="例如：客户服务平台" />
        <Field
          name="slug"
          title="仓库标识（选填）"
          required={false}
          placeholder="留空自动生成；填写时使用小写字母、数字和连字符"
        />
        {mode === "create" && (
          <Form.Item name="templateId" label="项目模板">
            <Select
              options={w.templates.map((template: Row) => ({
                value: template.id,
                label: `${template.name}${template.system ? " · 系统默认" : ` · ${template.skillIds.length} 个技能`}`,
              }))}
            />
          </Form.Item>
        )}
        {mode === "import" && (
          <Form.Item label="项目压缩包" required>
            <input
              aria-label="项目压缩包"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
            <p className="muted">
              支持 ZIP、TAR 及其 gzip / bzip2 / xz
              压缩，文件后缀不限。项目根目录只需有非空 agent.md，最多 32 MiB。
            </p>
          </Form.Item>
        )}
        <p className="muted">
          创建项目会从模板写入 agent.md 和技能清单；开发、测试和发布由 IDE 完成。
        </p>
      </ActionForm>
    </>
  );
}
function RequirementForm() {
  const { id } = useParams(),
    { w, project, refresh, session } = useData(),
    nav = useNavigate(),
    row = w.requirements.find((r: Row) => r.id === id);
  if (id && !row) return <Blank title="需求不存在" />;
  if (!project) return <NoProject />;
  const p = id ? w.projects.find((p: Row) => p.id === row.projectId) : project;
  return (
    <>
      <PageTitle
        title={id ? "需求详情" : "新建需求"}
        description="直接记录需求与进展，保存后立即生效。"
        back="/"
        action={
          id && canWrite(p, session) ? (
            <Link to={"/branches/new?requirement=" + id}>
              <Button>创建关联分支</Button>
            </Link>
          ) : undefined
        }
      />
      <ActionForm
        key={id || "new"}
        title={row?.title || "需求内容"}
        button="保存需求"
        disabled={!canWrite(p, session)}
        initialValues={
          row || {
            kind: "feature",
            priority: "normal",
            status: "OPEN",
            description: "",
          }
        }
        onSubmit={(v) =>
          act(id ? "requirement.update" : "requirement.create", {
            ...v,
            ...(id ? { id, revision: row.revision } : { projectId: p.id }),
          })
        }
        onDone={async () => {
          await refresh();
          nav("/");
        }}
      >
        <Field name="title" title="需求标题" />
        <Field
          name="description"
          title="需求说明"
          area
          required={false}
          placeholder="目标、使用场景和预期结果"
        />
        <div className="form-grid">
          <Form.Item name="kind" label="类型">
            <Select options={options(["feature", "defect", "change"])} />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select options={options(["low", "normal", "high"])} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={options(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"])}
            />
          </Form.Item>
        </div>
      </ActionForm>
      {row && (
        <Card title="关联记录" className="section-gap">
          <p>
            分支：
            {w.branches
              .filter((b: Row) => b.requirementId === id)
              .map((b: Row) => b.name)
              .join("、") || "暂无"}
          </p>
          <p>
            版本：
            {w.versions
              .filter((v: Row) => v.requirementIds.includes(id))
              .map((v: Row) => v.name)
              .join("、") || "暂无"}
          </p>
        </Card>
      )}
    </>
  );
}
function useRepository(projectId?: string) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const reload = async () => {
    if (!projectId) return;
    try {
      setData(await api("/projects/" + projectId + "/repository"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    setData(undefined);
    void reload();
  }, [projectId]);
  return { data, error, reload };
}
function Branches() {
  const { w, project, session } = useData(),
    { data, error, reload } = useRepository(project?.id);
  if (!project) return <NoProject />;
  const pulls = w.pulls.filter((r: Row) => r.projectId === project.id),
    writable = canWrite(project, session);
  return (
    <>
      <PageTitle
        title="分支与合并"
        description="从主线创建工作分支，在 IDE 完成开发，通过这里合并到 main。"
        action={
          writable ? (
            <Link to="/branches/new">
              <Button type="primary">创建分支</Button>
            </Link>
          ) : undefined
        }
      />
      {error && (
        <Alert
          type="error"
          message={error}
          action={<Button onClick={reload}>重试</Button>}
        />
      )}
      <h2>工作分支</h2>
      <div className="card-grid">
        {data?.branches.map((b: any) => {
          const row = w.branches.find(
              (r: Row) =>
                r.projectId === project.id &&
                r.name === b.name &&
                r.status === "ACTIVE",
            ),
            open =
              row &&
              pulls.find(
                (r: Row) => r.branchId === row.id && r.status === "OPEN",
              );
          return (
            <Card key={b.name} title={b.name}>
              <Typography.Text copyable>{b.sha}</Typography.Text>
              <p className="muted">
                {["main", "devops/control"].includes(b.name)
                  ? "受保护分支"
                  : row?.requirementId
                    ? w.requirements.find(
                        (r: Row) => r.id === row.requirementId,
                      )?.title
                    : "独立工作分支"}
              </p>
              {row && writable && (
                <Space wrap>
                  {open ? (
                    <Link to={"/pulls/" + open.id}>
                      <Button>查看 PR</Button>
                    </Link>
                  ) : (
                    <>
                      <Link to={"/pulls/new/" + row.id}>
                        <Button>创建 PR</Button>
                      </Link>
                      <Link to={"/branches/" + row.id + "/delete"}>
                        <Button danger>删除分支</Button>
                      </Link>
                    </>
                  )}
                </Space>
              )}
            </Card>
          );
        })}
      </div>
      {!data && !error && <Spin />}
      <h2 className="section-gap">合并请求</h2>
      {pulls.length ? (
        <div className="card-grid">
          {pulls.map((r: Row) => (
            <Link to={"/pulls/" + r.id} key={r.id}>
              <Card hoverable title={r.title}>
                <Tag color={r.status === "MERGED" ? "green" : "purple"}>
                  {r.status === "OPEN" ? "待合并" : "已合并"}
                </Tag>
                <p>#{r.number} → main</p>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Blank
          title="暂无合并请求"
          description="IDE 提交代码后，从工作分支创建 PR。"
        />
      )}
    </>
  );
}
function BranchForm() {
  const { w, project, refresh } = useData(),
    nav = useNavigate(),
    { data, error } = useRepository(project?.id),
    selected = new URLSearchParams(useLocation().search).get("requirement");
  if (!project) return <NoProject />;
  const main = data?.branches.find((b: any) => b.name === "main");
  return (
    <>
      <PageTitle
        title="创建工作分支"
        description="以当前 main 为基线。创建后即可在 IDE 开始开发。"
        back="/branches"
      />
      {error && <Alert type="error" message={error} />}
      <ActionForm
        title="分支信息"
        button="创建分支"
        disabled={!main}
        initialValues={{ requirementId: selected || undefined }}
        onSubmit={(v) =>
          act("branch.create", {
            projectId: project.id,
            baseSha: main.sha,
            ...v,
          })
        }
        onDone={async () => {
          await refresh();
          nav("/branches");
        }}
      >
        <Field
          name="name"
          title="分支名称"
          placeholder="feature/customer-import"
        />
        <Form.Item name="requirementId" label="关联需求（选填）">
          <Select
            allowClear
            options={w.requirements
              .filter((r: Row) => r.projectId === project.id)
              .map((r: Row) => ({ value: r.id, label: r.title }))}
          />
        </Form.Item>
        <p className="muted">基线 main · {shortSha(main?.sha)}</p>
      </ActionForm>
    </>
  );
}
function BranchDelete() {
  const { id } = useParams(),
    { w, refresh } = useData(),
    nav = useNavigate(),
    row = w.branches.find((r: Row) => r.id === id),
    { data, error } = useRepository(row?.projectId);
  if (!row) return <Blank title="分支不存在" />;
  const head = data?.branches.find((b: any) => b.name === row.name);
  return (
    <>
      <PageTitle title="删除工作分支" back="/branches" />
      {error && <Alert type="error" message={error} />}
      <ActionForm
        title={row.name}
        button="确认删除分支"
        disabled={!head}
        onSubmit={() => act("branch.delete", { id, headSha: head.sha })}
        onDone={async () => {
          await refresh();
          nav("/branches");
        }}
      >
        <p>
          将删除远端分支引用。有待合并 PR
          时不能删除；删除后若需要未合并提交，请先在 IDE 保留副本。
        </p>
        <Code value={head?.sha} />
      </ActionForm>
    </>
  );
}
function PullForm() {
  const { id } = useParams(),
    { w, refresh } = useData(),
    nav = useNavigate(),
    branch = w.branches.find((r: Row) => r.id === id);
  if (!branch) return <Blank title="分支不存在" />;
  return (
    <>
      <PageTitle
        title="创建合并请求"
        back="/branches"
        description={branch.name + " → main"}
      />
      <ActionForm
        title="变更说明"
        button="创建 PR"
        initialValues={{
          title:
            w.requirements.find((r: Row) => r.id === branch.requirementId)
              ?.title || branch.name,
          description: "",
        }}
        onSubmit={(v) =>
          act("pr.create", { projectId: branch.projectId, branchId: id, ...v })
        }
        onDone={async (r) => {
          await refresh();
          nav("/pulls/" + r.id);
        }}
      >
        <Field name="title" title="标题" />
        <Field name="description" title="说明" area required={false} />
      </ActionForm>
    </>
  );
}
function PullDetail() {
  const { id } = useParams(),
    { w, session, refresh } = useData(),
    [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [choices, setChoices] = useState<Record<string, "left" | "right">>({});
  const load = async () => {
    try {
      setData(await api("/pulls/" + id));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, [id]);
  if (!data)
    return (
      <>
        {error ? (
          <Alert
            message={error}
            type="error"
            action={<Button onClick={load}>重试</Button>}
          />
        ) : (
          <Spin />
        )}
      </>
    );
  const p = w.projects.find((p: Row) => p.id === data.projectId);
  const conflicts: Row[] = data.conflicts || [],
    hasConflicts = conflicts.length > 0,
    canChoose = session.actor?.role === "human" && canWrite(p, session),
    choicesComplete = conflicts.every((conflict) => choices[conflict.path]);
  return (
    <>
      <PageTitle
        title={data.title}
        back="/branches"
        description={"PR #" + data.number + " → main"}
        action={<Button onClick={load}>刷新差异</Button>}
      />
      <Card title={data.merged ? "已合并" : "变更差异"}>
        <Detail
          items={[
            ["工作分支", shortSha(data.headSha)],
            ["当前主线", shortSha(data.targetSha)],
            ["说明", data.description],
          ]}
        />
        <Code value={data.diff || "当前没有差异"} />
      </Card>
      {!data.merged && hasConflicts && (
        <Card
          title="冲突差异：未执行合并"
          className="section-gap conflict-card"
        >
          <Alert
            type="warning"
            showIcon
            message="DevOps Agent 已检测到冲突"
            description="左侧是当前 main，右侧是工作分支。请选择每个冲突点希望保留哪一侧；这里只记录你的选择，不会直接合并。IDE Agent 需要据此修改工作分支并重新推送。"
          />
          <div className="conflict-list">
            {conflicts.map((conflict) => (
              <Card key={conflict.id} size="small" title={conflict.path}>
                <p>{conflict.summary}</p>
                <div className="conflict-columns">
                  <div>
                    <div className="conflict-side-title">左侧 · main</div>
                    <Code value={conflict.left ?? "该文件在左侧不存在"} />
                  </div>
                  <div>
                    <div className="conflict-side-title">右侧 · 工作分支</div>
                    <Code value={conflict.right ?? "该文件在右侧不存在"} />
                  </div>
                </div>
                {canChoose ? (
                  <Radio.Group
                    aria-label={`选择 ${conflict.path} 的版本`}
                    value={choices[conflict.path]}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [conflict.path]: event.target.value,
                      }))
                    }
                  >
                    <Radio value="left">选择左侧 main</Radio>
                    <Radio value="right">选择右侧工作分支</Radio>
                  </Radio.Group>
                ) : (
                  <p className="muted">只有人类成员可以记录左右选择。</p>
                )}
              </Card>
            ))}
          </div>
          {canChoose && (
            <ActionForm
              title="记录人类选择"
              button="保存选择，不合并"
              disabled={!choicesComplete}
              onSubmit={async () =>
                act("pr.conflict.choice", {
                  id,
                  headSha: data.headSha,
                  targetSha: data.targetSha,
                  choices: conflicts.map((conflict) => ({
                    path: conflict.path,
                    choice: choices[conflict.path],
                  })),
                })
              }
              onDone={load}
            >
              <p className="muted">
                保存后 PR 仍保持待合并。IDE Agent
                读取选择并解决冲突后推送，页面会重新检测。
              </p>
            </ActionForm>
          )}
        </Card>
      )}
      {!data.merged && !hasConflicts && (
        <ActionForm
          title="合并到 main"
          button="合并 PR"
          disabled={!data.mergeable || !canWrite(p, session)}
          onSubmit={() =>
            act("pr.merge", {
              id,
              headSha: data.headSha,
              targetSha: data.targetSha,
            })
          }
          onDone={async () => {
            await refresh();
            await load();
          }}
        >
          <p>将上方提交合并到主线。需求状态由你或 IDE Agent 单独更新。</p>
          {!data.mergeable && (
            <Alert
              type="warning"
              message="暂时无法合并：请在 IDE 解决冲突，或等待 Git 检查完成后刷新。"
            />
          )}
        </ActionForm>
      )}
    </>
  );
}
function Versions() {
  const { w, project, session } = useData();
  if (!project) return <NoProject />;
  const rows = w.versions.filter((r: Row) => r.projectId === project.id);
  return (
    <>
      <PageTitle
        title="版本"
        description="为主线提交建立不可变标签，记录版本包含的需求。版本记录不表示已部署。"
        action={
          canWrite(project, session) ? (
            <Link to="/versions/new">
              <Button type="primary">登记版本</Button>
            </Link>
          ) : undefined
        }
      />
      {rows.length ? (
        <div className="card-grid">
          {rows.map((r: Row) => (
            <Card key={r.id} title={r.name}>
              <Typography.Text copyable>{r.sha}</Typography.Text>
              <p className="preserve-lines">{r.notes || "暂无变更说明"}</p>
              <Space wrap>
                {r.requirementIds.map((id: string) => (
                  <Link key={id} to={"/requirements/" + id}>
                    <Tag color="purple">
                      {w.requirements.find((q: Row) => q.id === id)?.title}
                    </Tag>
                  </Link>
                ))}
              </Space>
              <p className="muted">{date(r.createdAt)}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Blank
          title="还没有版本"
          description="合并完成后，为 main 提交创建第一个版本标签。"
        />
      )}
    </>
  );
}
function VersionForm() {
  const { w, project, refresh } = useData(),
    nav = useNavigate(),
    { data, error } = useRepository(project?.id);
  if (!project) return <NoProject />;
  const main = data?.branches.find((r: any) => r.name === "main");
  return (
    <>
      <PageTitle
        title="登记版本"
        back="/versions"
        description="创建真实 Git 标签。登记后不可覆盖，发布由 IDE 完成。"
      />
      {error && <Alert type="error" message={error} />}{" "}
      {main ? (
        <ActionForm
          key={main.sha}
          title="版本信息"
          button="创建版本标签"
          initialValues={{ sha: main.sha, notes: "", requirementIds: [] }}
          onSubmit={(v) =>
            act("version.create", { projectId: project.id, ...v })
          }
          onDone={async () => {
            await refresh();
            nav("/versions");
          }}
        >
          <Field name="name" title="版本名称" placeholder="v1.0.0" />
          <Field name="sha" title="提交 SHA" />
          <p className="muted">
            默认当前 main，也可填写 main 历史中的完整提交 SHA。
          </p>
          <Field name="notes" title="变更说明" area required={false} />
          <Form.Item name="requirementIds" label="包含需求（选填）">
            <Select
              mode="multiple"
              options={w.requirements
                .filter((r: Row) => r.projectId === project.id)
                .map((r: Row) => ({ value: r.id, label: r.title }))}
            />
          </Form.Item>
        </ActionForm>
      ) : (
        !error && <Spin />
      )}
    </>
  );
}
function Settings() {
  const { w, project, refresh, session } = useData();
  if (!project) return <NoProject />;
  const owner = project.members[session.user.id] === "owner";
  return (
    <>
      <PageTitle
        title="项目与授权"
        description="同一账号连接 IDE 与 DevOps，所有远端 Git 操作均从此进入。"
        action={
          <Space>
            <Link to="/projects/new">
              <Button>创建或导入项目</Button>
            </Link>
            {session.user.admin && (
              <Link to="/users/new">
                <Button>创建统一账号</Button>
              </Link>
            )}
            {canWrite(project, session) && (
              <Link to="/credentials/new">
                <Button type="primary">授权 IDE / Agent</Button>
              </Link>
            )}
          </Space>
        }
      />
      <Card title={project.name}>
        <Detail
          items={[
            [
              "Git 唯一入口",
              <Typography.Text copyable>
                {location.origin + "/git/" + project.slug + ".git"}
              </Typography.Text>,
            ],
            [
              "项目 ID",
              <Typography.Text copyable>{project.id}</Typography.Text>,
            ],
            ["你的角色", label(project.members[session.user.id])],
            ["职责", "DevOps 管理需求与版本；IDE 负责开发、全部测试和发布。"],
          ]}
        />
        <p className="muted">
          在 IDE 使用统一账号的用户名和下面签发的短时凭证作为 Git 密码。
        </p>
      </Card>
      {(w.requests.some((r: Row) => r.projectId === project.id) ||
        project.projectionPending ||
        project.status === "UNKNOWN") && (
        <Card title="仓库状态需要核对" className="section-gap">
          <p>读取实际 Git 状态，核对上次未确定的操作并重新同步需求投影。</p>
          <ActionButton
            text="核对仓库"
            action={() =>
              act("repository.reconcile", { projectId: project.id })
            }
            refresh={refresh}
          />
        </Card>
      )}
      <h2 className="section-gap">我的委托</h2>
      <div className="card-grid">
        {w.credentials
          .filter((r: Row) => r.projectId === project.id)
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
      <h2 className="section-gap">项目成员</h2>
      <div className="card-grid">
        {Object.entries(project.members).map(([id, role]) => (
          <Card key={id}>
            <strong>
              {w.users.find((u: Row) => u.id === id)?.username || id}
            </strong>
            <p>{label(String(role))}</p>
          </Card>
        ))}
      </div>
      {owner && (
        <>
          <ActionForm
            title="添加或调整成员"
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
                  value: u.id,
                  label: u.username,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="role"
              label="项目角色"
              rules={[{ required: true }]}
            >
              <Select
                options={options(["owner", "member", "observer", "remove"])}
              />
            </Form.Item>
          </ActionForm>
          <ActionForm
            key={project.id}
            title="项目名称"
            initialValues={{ name: project.name }}
            onSubmit={(v) =>
              act("project.update", { projectId: project.id, ...v })
            }
            onDone={refresh}
          >
            <Field name="name" title="名称" />
          </ActionForm>
        </>
      )}
      {session.user.admin && (
        <Card title="统一账号管理" className="section-gap">
          {w.users
            .filter((u: Row) => u.id !== session.user.id)
            .map((u: Row) => (
              <div key={u.id}>
                <strong>
                  {u.username} · {u.active ? "正常" : "已停用"}
                </strong>
                <ActionButton
                  text={u.active ? "停用账号" : "启用账号"}
                  action={() =>
                    act("user.update", { userId: u.id, active: !u.active })
                  }
                  refresh={refresh}
                />
              </div>
            ))}
        </Card>
      )}
    </>
  );
}
function CredentialForm() {
  const { project, refresh } = useData(),
    [result, setResult] = useState<any>();
  if (!project) return <NoProject />;
  return (
    <>
      <PageTitle
        title="授权 IDE / Agent"
        back="/settings"
        description="委托继承你的当前项目权限，可随时撤销。"
      />
      {result ? (
        <Card title="凭证已生成">
          <Alert type="success" message="请立即复制，明文只显示这一次。" />
          <Typography.Paragraph copyable className="credential-token">
            {result.token}
          </Typography.Paragraph>
          <Detail
            items={[
              ["到期时间", date(result.expiresAt)],
              ["DEVOPS_URL", location.origin],
              ["DEVOPS_PROJECT", project.id],
            ]}
          />
          <p>
            将凭证放入 IDE 的 DEVOPS_TOKEN 环境变量，或用作 Git
            网关密码。不要写入仓库。
          </p>
          <Link to="/settings">
            <Button>返回项目</Button>
          </Link>
        </Card>
      ) : (
        <ActionForm
          title="委托信息"
          button="生成短时凭证"
          initialValues={{ role: "ide_agent", hours: 1 }}
          onSubmit={(v) =>
            act("credential.create", { projectId: project.id, ...v })
          }
          onDone={async (r) => {
            setResult(r);
            await refresh();
          }}
        >
          <Field name="name" title="委托名称" placeholder="我的 IDE" />
          <Form.Item name="role" label="用途">
            <Select options={options(["human", "ide_agent", "devops_agent"])} />
          </Form.Item>
          <p className="muted">
            IDE Agent 可维护需求和版本、推送工作分支；DevOps Agent 仅维护需求。
          </p>
          <Form.Item name="hours" label="有效期">
            <Select
              options={[1, 4, 8, 24].map((value) => ({
                value,
                label: value + " 小时",
              }))}
            />
          </Form.Item>
        </ActionForm>
      )}
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
