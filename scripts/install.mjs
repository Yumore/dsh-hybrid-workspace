#!/usr/bin/env node
/**
 * 把 dsh-hybrid-workspace-v2 装进 / 卸出当前 DSH profile。
 *
 *   node scripts/install.mjs                     # dry-run
 *   node scripts/install.mjs --apply             # 写入（先备份）
 *   node scripts/install.mjs --apply --replace   # 先移除 v1，再装 v2
 *   node scripts/install.mjs --apply --uninstall # 只卸 v2
 *
 * 注意：v1 与 v2 使用同一个插件 id（hybrid-workspace）和系统提示词 section，
 * 同时加载会重复注册。装 v2 前必须卸 v1；--replace 会代做这一步。
 */
import { promises as fsp } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG = 'dsh-hybrid-workspace-v2';
const OLD = 'dsh-hybrid-workspace';
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = process.env.DSH_PROFILE_DIR ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop');
const pkgPath = join(profileDir, 'package.json');
const patchPath = join(profileDir, 'cordis.patch.yml');
const linkPath = join(profileDir, 'node_modules', PKG);
const oldLinkPath = join(profileDir, 'node_modules', OLD);

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const UNINSTALL = args.has('--uninstall');
const REPLACE = args.has('--replace');
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const log = (...a) => console.log(...a);

const readJSON = async (p) => JSON.parse(await fsp.readFile(p, 'utf8'));

const OLD_BLOCK = /\n?# ── 混合工作区（dsh-hybrid-workspace）[\s\S]*?debug: true\n?/u;
const NEW_BLOCK = /\n?# ── 混合工作区 v2（dsh-hybrid-workspace-v2）[\s\S]*?debug: true\n?/u;

function patchBlock () {
  return [
    '# ── 混合工作区 v2（dsh-hybrid-workspace-v2）────────────────────────',
    '# 单聊天框 + 工作区路由 + 结构化记忆；每轮只注入当前区的预算化上下文',
    '- id: hybrid-workspace',
    '  name: dsh-hybrid-workspace-v2',
    '  config:',
    '    mode: hybrid',
    '    routeAccept: 0.48',
    '    contextMaxChars: 2400',
    '    memoryInject: 8',
    '    debug: true',
  ].join('\n');
}

async function main () {
  log('profile: ' + profileDir);
  log('source : ' + SRC);
  log('mode   : ' + (UNINSTALL ? 'uninstall' : APPLY ? (REPLACE ? 'apply+replace' : 'apply') : 'dry-run'));

  const pkg = await readJSON(pkgPath);
  const deps = pkg.dependencies ?? {};
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  let patchText = '';
  try { patchText = await fsp.readFile(patchPath, 'utf8'); } catch { /* 可不存在 */ }

  const hasOld = Boolean(deps[OLD]) || bundles.includes(OLD) || patchText.includes('name: ' + OLD);
  if (hasOld && !UNINSTALL && !REPLACE) {
    log('\n检测到已安装 v1（' + OLD + '）。');
    log('v1 与 v2 共用 id / section，同时加载会重复注册。');
    log('先卸 v1：cd ../dsh-hybrid-workspace && node scripts/install.mjs --apply --uninstall');
    log('或加 --replace 让本脚本代卸。');
    if (APPLY) process.exit(2);
  }

  const plan = [];
  if (!UNINSTALL) {
    if (REPLACE && hasOld) plan.push(['移除 v1 条目 / 软链 / 依赖', '(present)', '(removed)']);
    if (deps[PKG] !== 'file:' + SRC) plan.push(['package.json dependencies["' + PKG + '"]', deps[PKG] ?? '(absent)', 'file:' + SRC]);
    if (!bundles.includes(PKG)) plan.push(['package.json dsh.profile.bundles', '(absent)', PKG]);
    if (!patchText.includes('name: ' + PKG)) plan.push(['cordis.patch.yml', '(absent)', 'insert block']);
    plan.push(['node_modules/' + PKG, 'symlink', SRC]);
  } else {
    if (deps[PKG]) plan.push(['package.json dependencies["' + PKG + '"]', deps[PKG], '(removed)']);
    if (bundles.includes(PKG)) plan.push(['package.json dsh.profile.bundles', PKG, '(removed)']);
    if (patchText.includes('name: ' + PKG)) plan.push(['cordis.patch.yml', 'insert block', '(removed)']);
    plan.push(['node_modules/' + PKG, 'symlink', '(removed)']);
  }

  if (!plan.length) { log('\nnothing to do — 已是目标状态'); return; }
  log('\n计划改动:');
  for (const [what, from, to] of plan) log('  · ' + what + ': ' + from + ' → ' + to);
  if (!APPLY) { log('\n(dry-run，未写入；加 --apply 执行)'); return; }

  for (const p of [pkgPath, patchPath]) {
    try { await fsp.copyFile(p, p + '.bak-' + stamp); } catch { /* 文件可能不存在 */ }
  }

  if (UNINSTALL) {
    delete deps[PKG];
    if (pkg.dsh?.profile) pkg.dsh.profile.bundles = bundles.filter(b => b !== PKG);
    patchText = patchText.replace(NEW_BLOCK, '\n');
    await fsp.rm(linkPath, { force: true });
  } else {
    if (REPLACE && hasOld) {
      delete deps[OLD];
      if (pkg.dsh?.profile) pkg.dsh.profile.bundles = bundles.filter(b => b !== OLD);
      patchText = patchText.replace(OLD_BLOCK, '\n');
      await fsp.rm(oldLinkPath, { force: true });
    }
    deps[PKG] = 'file:' + SRC;
    pkg.dependencies = deps;
    if (!bundles.includes(PKG)) {
      pkg.dsh ??= {};
      pkg.dsh.profile ??= {};
      pkg.dsh.profile.bundles = [...(pkg.dsh.profile.bundles ?? []), PKG];
    }
    if (!patchText.includes('name: ' + PKG)) {
      patchText = patchText.replace(/\s*$/u, '\n') + patchBlock() + '\n';
    }
    await fsp.mkdir(dirname(linkPath), { recursive: true });
    await fsp.rm(linkPath, { force: true });
    await fsp.symlink(SRC, linkPath, 'dir');
  }

  await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  await fsp.writeFile(patchPath, patchText, 'utf8');
  log('\n已写入。备份后缀 .bak-' + stamp);
  log('重启 DeepSeek Harness 后生效；面板 ' + '/hybrid-workspace/');
}

main().catch((error) => { console.error('install failed: ' + (error?.message ?? error)); process.exit(1); });
