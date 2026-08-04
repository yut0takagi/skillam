export interface RoleSkill {
  id: number
  skillSource: 'user' | 'project-local' | 'plugin'
  skillPath: string
}

export interface RoleSkillInput {
  skillSource: 'user' | 'project-local' | 'plugin'
  skillPath: string
}
