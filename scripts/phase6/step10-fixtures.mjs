/** Offline fixture/cleanup compiler. No network, env loading or hosted execution. */
import { randomUUID } from "node:crypto";
export const project = "ukdzggjfkcwjssjmnqim";
export const tables = [
  "consultation_subjects",
  "consultation_threads",
  "consultation_turns",
  "diagnoses",
  "diagnosis_answers",
  "free_reports",
];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const q = (x) => "'" + x + "'";
export function fixturePlan(users, hashes) {
  if (
    users.length !== 2 ||
    hashes.length !== 2 ||
    new Set(users).size !== 2 ||
    new Set(hashes).size !== 2 ||
    !users.every((x) => uuid.test(x)) ||
    !hashes.every((x) => /^[a-f0-9]{64}$/.test(x))
  )
    throw new Error(
      "Two distinct validated owners and session hashes required",
    );
  return {
    version: 1,
    project,
    run: randomUUID(),
    users: [...users],
    hashes: [...hashes],
    rows: Object.fromEntries(
      tables.map((t) => [t, [randomUUID(), randomUUID()]]),
    ),
  };
}
export function validatePlan(p) {
  if (
    p.version !== 1 ||
    p.project !== project ||
    !uuid.test(p.run) ||
    p.users.length !== 2 ||
    new Set(p.users).size !== 2 ||
    !p.users.every((x) => uuid.test(x)) ||
    p.hashes.length !== 2 ||
    new Set(p.hashes).size !== 2 ||
    !p.hashes.every((x) => /^[a-f0-9]{64}$/.test(x)) ||
    Object.keys(p.rows).sort().join() !== [...tables].sort().join()
  )
    throw new Error("Invalid fixture manifest");
  const ids = tables.flatMap((t) => p.rows[t]);
  if (
    tables.some((t) => !Array.isArray(p.rows[t]) || p.rows[t].length !== 2) ||
    ids.length !== 12 ||
    new Set(ids).size !== 12 ||
    !ids.every((x) => uuid.test(x)) ||
    ids.some((x) => p.users.includes(x))
  )
    throw new Error("Invalid fixture UUIDs");
  return p;
}
export function insertSQL(plan) {
  const p = validatePlan(plan),
    statements = [];
  for (let i = 0; i < 2; i++) {
    const id = (t) => q(p.rows[t][i]),
      user = q(p.users[i]),
      marker = `STEP10-${p.run.slice(0, 8)}-${i}`;
    statements.push(
      `insert into public.consultation_subjects(id,user_id,nickname) values(${id("consultation_subjects")},${user},'${marker}');`,
      `insert into public.consultation_threads(id,user_id,subject_id,title) values(${id("consultation_threads")},${user},${id("consultation_subjects")},'${marker} 合成履歴');`,
      `insert into public.consultation_turns(id,user_id,thread_id,user_text,assistant_text,status,charged,plan,period_start,period_end) values(${id("consultation_turns")},${user},${id("consultation_threads")},'${marker} 架空のテスト質問','${marker} 合成回答・AI生成なし','ready',false,'free',now(),now()+interval '1 day');`,
      `insert into public.diagnoses(id,anonymous_session_id,diagnosis_type_id,status,classification_json) values(${id("diagnoses")},'${p.hashes[i]}',(select id from public.diagnosis_types where slug='partner-mind'),'free_result_ready','{"synthetic":"${p.run}"}');`,
      `insert into public.diagnosis_answers(id,diagnosis_id,question_key,question_text,answer_text) values(${id("diagnosis_answers")},${id("diagnoses")},'step10','${marker} 架空の質問','${marker} 架空の回答');`,
      `insert into public.free_reports(id,diagnosis_id,report_json,model,prompt_version) values(${id("free_reports")},${id("diagnoses")},'{"synthetic":"${p.run}","text":"表示検証用・生成なし"}','synthetic-no-ai','step10');`,
    );
  }
  return "begin;\n" + statements.join("\n") + "\ncommit;";
}
/** All known FK references must belong to the manifest. Fail rather than cascade unknown rows. */
export function cleanupSQL(plan) {
  const p = validatePlan(plan),
    ids = (t) => p.rows[t].map(q).join(","),
    checks = [];
  const plannedRelations = [
    ["consultation_threads", "subject_id", "consultation_subjects"],
    ["consultation_turns", "thread_id", "consultation_threads"],
    ["diagnosis_answers", "diagnosis_id", "diagnoses"],
    ["free_reports", "diagnosis_id", "diagnoses"],
  ];
  for (const [child, column, parent] of plannedRelations)
    checks.push(
      `if exists(select 1 from public.${child} where ${column} in (${ids(parent)}) and id not in (${ids(child)})) then raise exception 'Unexpected dependent fixture row'; end if;`,
    );
  const extraRelations = [
    ["subject_diagnoses", "subject_id", "consultation_subjects"],
    ["subject_diagnoses", "diagnosis_id", "diagnoses"],
    ["trial_thread_context", "thread_id", "consultation_threads"],
    ["consultation_ai_calls", "turn_id", "consultation_turns"],
    ["diagnosis_analyses", "diagnosis_id", "diagnoses"],
    ["diagnosis_selected_questions", "diagnosis_id", "diagnoses"],
    ["payments", "diagnosis_id", "diagnoses"],
    ["paid_reports", "diagnosis_id", "diagnoses"],
    ["ai_calls", "diagnosis_id", "diagnoses"],
    ["affiliate_recommendations", "diagnosis_id", "diagnoses"],
    ["affiliate_clicks", "diagnosis_id", "diagnoses"],
  ];
  for (const [table, column, parent] of extraRelations)
    checks.push(
      `if exists(select 1 from public.${table} where ${column} in (${ids(parent)})) then raise exception 'Unexpected dependent fixture row'; end if;`,
    );
  for (const t of tables)
    checks.push(
      `if (select count(*) from public.${t} where id in (${ids(t)}))<>2 then raise exception 'Fixture count mismatch'; end if;`,
    );
  for (const [child, column, parent] of [
    ["consultation_threads", "subject_id", "consultation_subjects"],
    ["consultation_turns", "thread_id", "consultation_threads"],
    ["diagnosis_answers", "diagnosis_id", "diagnoses"],
    ["free_reports", "diagnosis_id", "diagnoses"],
  ])
    for (let i = 0; i < 2; i++)
      checks.push(
        `if not exists(select 1 from public.${child} where id='${p.rows[child][i]}' and ${column}='${p.rows[parent][i]}') then raise exception 'Fixture relation mismatch'; end if;`,
      );
  for (const t of tables.slice(0, 3))
    for (let i = 0; i < 2; i++)
      checks.push(
        `if not exists(select 1 from public.${t} where id='${p.rows[t][i]}' and user_id='${p.users[i]}') then raise exception 'Fixture owner mismatch'; end if;`,
      );
  for (let i = 0; i < 2; i++)
    checks.push(
      `if not exists(select 1 from public.diagnoses where id='${p.rows.diagnoses[i]}' and (user_id is null or user_id='${p.users[i]}') and classification_json->>'synthetic'='${p.run}' and anonymous_session_id='${p.hashes[i]}') then raise exception 'Diagnosis fixture mismatch'; end if;`,
    );
  const deleteOrder = [
    "consultation_turns",
    "consultation_threads",
    "consultation_subjects",
    "diagnosis_answers",
    "free_reports",
    "diagnoses",
  ];
  const relations = [...plannedRelations, ...extraRelations];
  const lockedTables = [
    ...new Set([...tables, ...relations.map(([t]) => t)]),
  ].sort();
  const expectedRelations = relations
    .map(([child, column, parent]) => `('${child}','${column}','${parent}')`)
    .join(",");
  checks.unshift(`if (select count(*) from pg_constraint where contype='f' and confrelid in (${tables.map((t) => `'public.${t}'::regclass`).join(",")}))<>15 or exists (
    select 1 from pg_constraint c where c.contype='f' and c.confrelid in (${tables.map((t) => `'public.${t}'::regclass`).join(",")}) and not exists (
      select 1 from (values ${expectedRelations}) expected(child,column_name,parent)
      join pg_attribute a on a.attrelid=c.conrelid and a.attname=expected.column_name
      where c.conrelid=('public.'||expected.child)::regclass and c.confrelid=('public.'||expected.parent)::regclass and a.attnum=any(c.conkey)
    )) then raise exception 'Fixture FK schema drift'; end if;`);
  // Freeze both parents and all dependent tables before checking: no concurrent cascade/SET NULL race.
  return (
    `begin;\nset local lock_timeout='3s';\nlock table ${lockedTables.map((t) => "public." + t).join(",")} in share row exclusive mode;\ndo $$ begin\n${checks.join("\n")}\nend $$;\n` +
    deleteOrder
      .map((t) => `delete from public.${t} where id in (${ids(t)});`)
      .join("\n") +
    "\ncommit;"
  );
}
