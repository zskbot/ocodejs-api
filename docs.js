// Render the skill catalog into the docs page.
// Data comes from /api/skills.json (static in the val, not fetched upstream).

const listEl = document.getElementById("skills-list");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderSkill(skill) {
  const row = el("li", "skill");
  row.appendChild(el("code", "skill-name", skill.name));
  row.appendChild(el("span", "skill-desc", skill.description));
  return row;
}

function renderGroup(category, skills) {
  const group = el("div", "skill-group");

  const head = el("div", "skill-group-head");
  head.appendChild(el("h3", "skill-group-name", category.name));
  head.appendChild(el("span", "pill", String(skills.length)));
  group.appendChild(head);

  group.appendChild(el("p", "skill-group-desc", category.description));

  const list = el("ul", "skill-list");
  for (const skill of skills) list.appendChild(renderSkill(skill));
  group.appendChild(list);

  return group;
}

async function loadSkills() {
  try {
    const res = await fetch("/api/skills.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const catalog = await res.json();

    listEl.replaceChildren();

    if (catalog.skills.length === 0) {
      listEl.appendChild(el("span", "mono", "Không có skill nào."));
      return;
    }

    // Group skills under their category, preserving catalog order.
    for (const category of catalog.categories) {
      const inCategory = catalog.skills.filter((s) => s.category === category.id);
      if (inCategory.length === 0) continue;
      listEl.appendChild(renderGroup(category, inCategory));
    }
  } catch (err) {
    listEl.replaceChildren();
    listEl.appendChild(
      el("div", "alert", `Không tải được danh mục skills: ${err.message}`),
    );
  }
}

loadSkills();
