import { z } from 'zod'

export const platformRoles = ['platform_admin', 'platform_auditor', 'platform_security_admin'] as const
export const projectRoles = ['project_owner', 'project_member', 'project_stakeholder'] as const
export const agentTypes = [
  'intake-agent',
  'design-impact-agent',
  'context-agent',
  'review-agent',
  'test-agent',
  'release-agent',
  'monitor-agent'
] as const
export const statuses = ['inbox', 'ready', 'in_progress', 'awaiting_acceptance', 'completed'] as const
export const text = z.string().trim().min(1).max(10000)
export const revision = z.string().regex(/^[a-f0-9]{40}$/i, '需要固定的 40 位 Git 提交 SHA')
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/i, '需要 SHA-256 制品摘要')
export const requirementsSchema = z.object({
  summary: text,
  userStory: z.string().default(''),
  acceptanceCriteria: z.array(text).min(1),
  nfr: z.array(text).default([]),
  scope: z.string().default('')
})
export const findingSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  category: text,
  path: text.max(512),
  resourceKey: z.string().default(''),
  line: z.number().int().positive().optional(),
  message: text.max(512),
  evidence: z.array(text).min(1),
  impact: text,
  suggestion: text,
  confidence: z.number().min(0).max(1)
})
export const agentOutputSchema = z.object({
  summary: text,
  confidence: z.number().min(0).max(1),
  evidence: z.array(text).min(1),
  risks: z.array(text),
  questions: z.array(text),
  userStory: z.string().optional(),
  acceptanceCriteria: z.array(text).optional(),
  design: z.string().optional(),
  tasks: z.array(text).optional(),
  findings: z.array(findingSchema).optional(),
  tests: z.array(text).optional(),
  impact: z.array(text).optional(),
  configuration: z.record(z.string(), z.string()).optional(),
  runbook: z.array(text).optional(),
  recovery: z.array(text).optional(),
  hypotheses: z.array(text).optional()
})
export type AgentOutput = z.infer<typeof agentOutputSchema>
export type PlatformRole = (typeof platformRoles)[number]
export type ProjectRole = (typeof projectRoles)[number]
