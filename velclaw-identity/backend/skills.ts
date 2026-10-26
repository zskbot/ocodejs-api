// Skill catalog for Velclaw Identity.
//
// This is a *static* catalog: the data lives in the val so the endpoint never
// touches the network or hits a rate limit. It mirrors the groupings from
// zskbot/docs-ocodejs `docs/AGENT-SKILLS-DIRECTORY.md` — when that document
// changes, update this file.
//
// Boundary note (same as the upstream doc): this is a reference directory. We
// do not host, mirror or execute any of these skills, and listing one is not a
// compatibility claim.

export type Skill = {
  /** Stable identifier used in URLs and filters. */
  id: string;
  /** Display name, matching the upstream directory. */
  name: string;
  /** One-line description of what the skill is for. */
  description: string;
  /** Category id this skill belongs to. */
  category: string;
  /** Where the skill is published / documented. */
  source: string;
};

export type SkillCategory = {
  id: string;
  name: string;
  description: string;
};

export const SKILL_CATEGORIES: SkillCategory[] = [
  {
    id: "codebase",
    name: "Codebase, kiến trúc & kiểm thử",
    description:
      "Khám phá cấu trúc dự án, chẩn đoán lỗi, cải thiện kiến trúc và phát triển theo hướng test-first.",
  },
  {
    id: "frontend",
    name: "Frontend & UI/UX",
    description:
      "Thiết kế giao diện web/app và áp dụng thực hành tốt cho React/Next.js.",
  },
  {
    id: "creative",
    name: "Sáng tạo & đa phương tiện",
    description:
      "Quy trình tạo video, hoạt ảnh và nội dung chuyển động bằng AI.",
  },
  {
    id: "automation",
    name: "Tự động hóa & điều phối",
    description:
      "Điều khiển trình duyệt, tự động hóa tác vụ và bàn giao công việc giữa agent với người dùng.",
  },
];

const SKILLS_SOURCE = "https://skills.sh/";

export const SKILLS: Skill[] = [
  {
    id: "find-skills",
    name: "find-skills",
    description: "Tìm và khám phá skills phù hợp với nhu cầu công việc.",
    category: "codebase",
    source: SKILLS_SOURCE,
  },
  {
    id: "diagnosing-bugs",
    name: "diagnosing-bugs",
    description: "Quy trình chẩn đoán lỗi có hệ thống.",
    category: "codebase",
    source: SKILLS_SOURCE,
  },
  {
    id: "improve-codebase-architecture",
    name: "improve-codebase-architecture",
    description: "Rà soát và cải thiện kiến trúc codebase.",
    category: "codebase",
    source: SKILLS_SOURCE,
  },
  {
    id: "domain-modeling",
    name: "domain-modeling",
    description: "Mô hình hóa miền nghiệp vụ.",
    category: "codebase",
    source: SKILLS_SOURCE,
  },
  {
    id: "tdd",
    name: "tdd",
    description: "Phát triển theo hướng kiểm thử trước.",
    category: "codebase",
    source: SKILLS_SOURCE,
  },
  {
    id: "frontend-design",
    name: "frontend-design",
    description: "Thiết kế giao diện web.",
    category: "frontend",
    source: SKILLS_SOURCE,
  },
  {
    id: "design-mobile-apps",
    name: "design-mobile-apps",
    description: "Thiết kế trải nghiệm ứng dụng di động.",
    category: "frontend",
    source: SKILLS_SOURCE,
  },
  {
    id: "vercel-react-best-practices",
    name: "vercel-react-best-practices",
    description: "Thực hành tốt cho React/Next.js.",
    category: "frontend",
    source: SKILLS_SOURCE,
  },
  {
    id: "ai-video-generation",
    name: "ai-video-generation",
    description: "Quy trình tạo video bằng AI.",
    category: "creative",
    source: SKILLS_SOURCE,
  },
  {
    id: "hyperframes",
    name: "hyperframes",
    description: "Khung dựng hoạt ảnh.",
    category: "creative",
    source: SKILLS_SOURCE,
  },
  {
    id: "hyperframes-animation",
    name: "hyperframes-animation",
    description: "Kỹ thuật animation nâng cao.",
    category: "creative",
    source: SKILLS_SOURCE,
  },
  {
    id: "hyperframes-creative",
    name: "hyperframes-creative",
    description: "Hướng sáng tạo với hyperframes.",
    category: "creative",
    source: SKILLS_SOURCE,
  },
  {
    id: "agent-browser",
    name: "agent-browser",
    description: "Tự động hóa tương tác trình duyệt.",
    category: "automation",
    source: SKILLS_SOURCE,
  },
  {
    id: "reddit-automation",
    name: "reddit-automation",
    description: "Quy trình tự động hóa Reddit.",
    category: "automation",
    source: SKILLS_SOURCE,
  },
  {
    id: "lark-doc",
    name: "lark-doc",
    description: "Hỗ trợ quy trình tài liệu Lark.",
    category: "automation",
    source: SKILLS_SOURCE,
  },
  {
    id: "triage",
    name: "triage",
    description: "Phân loại và ưu tiên yêu cầu.",
    category: "automation",
    source: SKILLS_SOURCE,
  },
  {
    id: "handoff",
    name: "handoff",
    description: "Bàn giao tác vụ và ngữ cảnh giữa agent/người dùng.",
    category: "automation",
    source: SKILLS_SOURCE,
  },
];

/** Catalog shaped for the API response, with categories nested under skills. */
export function skillCatalog() {
  return {
    source: SKILLS_SOURCE,
    upstream:
      "https://github.com/zskbot/docs-ocodejs/blob/main/docs/AGENT-SKILLS-DIRECTORY.md",
    install: "npx skills add <owner/repo>",
    notice:
      "Danh mục tham khảo. Val này không host, mirror hay thực thi skill nào, " +
      "và việc liệt kê không phải xác nhận tương thích.",
    categories: SKILL_CATEGORIES,
    skills: SKILLS,
    counts: {
      categories: SKILL_CATEGORIES.length,
      skills: SKILLS.length,
    },
  };
}
