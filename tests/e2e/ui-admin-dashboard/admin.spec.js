import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';

const tabs = ['Overview','By skill','Mistakes','Traps','Pacing','Second-guessing','History','Lessons'];
const artifact = '.opencode/pipeline/ui-admin-dashboard/e2e';
const post = async (context, path, data) => {
  const response = await context.request.post(path, { headers:{Origin:ORIGIN}, data });
  expect(response.status(), await response.text()).toBe(200); return response.json();
};
for (const viewport of [{width:1920,height:1080},{width:1366,height:768}]) {
  const size = `${viewport.width}x${viewport.height}`;
  const shot = async (page, name) => {
    await page.evaluate(() => document.fonts.ready);
    if (!/preview|editor|time-error|session-created|past-sessions/.test(name)) await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({ path:`${artifact}/${size}/${name}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  test(`admin inventory, editor exits and archive ${size}`, async ({browser}) => {
    test.setTimeout(120000); mkdirSync(`${artifact}/${size}`,{recursive:true});
    const context = await newUserContext(browser,'e2e-admin',{viewport});
    try {
      const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto('/admin'); await expect(page.locator('tbody tr')).toHaveCount(6); await shot(page,'students');
      await page.locator('#collapse').click(); await shot(page,'sidebar-collapsed'); await page.locator('#collapse').click();
      await page.locator('[data-id="e2e-student-1"]').click();
      for (const tab of tabs) {
        await page.getByRole('tab',{name:tab,exact:true}).click(); await expect(page.locator('#tab-content')).not.toContainText('Loading…');
        await shot(page,`student-${tab.toLowerCase().replaceAll(' ','-')}`);
        if(tab==='Mistakes') {
          await page.locator('[data-question="e2e-core-math"]').click(); await expect(page.locator('#preview .choice')).toHaveCount(4); await page.locator('#preview').scrollIntoViewIfNeeded(); await shot(page,'mistake-mc-preview');
          await page.locator('#close-preview').click(); await page.locator('[data-question="e2e-core-spr"]').click(); await expect(page.locator('#preview .gridin')).toBeVisible(); await page.locator('#preview').scrollIntoViewIfNeeded(); await shot(page,'mistake-spr-preview');
          await page.locator('#close-preview').click();
          await page.locator('#md-skill').selectOption('Central Ideas and Details'); await page.locator('#md-domain').selectOption('Algebra'); await expect(page.locator('#mistakes')).toContainText('No mistakes for these filters.'); await shot(page,'mistakes-empty');
        }
        if(tab==='History') {await page.locator('#h-next').click();await expect(page.locator('#tab-content')).toContainText('Page 2 of 2');await shot(page,'student-history-page2');}
      }
      await page.locator('#back').click(); await page.locator('[data-id="e2e-student-5"]').click();
      for(const tab of tabs) {await page.getByRole('tab',{name:tab,exact:true}).click();await expect(page.locator('#tab-content .empty')).toHaveCount(1);await expect(page.locator('#tab-content')).toHaveText('No practice attempts yet');await shot(page,`empty-${tab.toLowerCase().replaceAll(' ','-')}`);}
      await page.locator('#back').click(); await page.locator('#search').fill('no-matching-person'); await expect(page.locator('tbody tr')).toHaveCount(0); await shot(page,'students-empty');
      await page.goto('/admin/questions'); await expect(page.locator('#results [data-preview]')).toHaveCount(7); await shot(page,'question-bank');
      await page.locator('[data-preview="e2e-core-math"]').click(); await expect(page.getByRole('dialog')).toBeVisible(); await shot(page,'bank-preview'); await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
      await page.locator('#f-search').fill('no-such-question');await expect(page.locator('#results')).toContainText('No results.');await shot(page,'bank-empty');
      await page.goto('/admin/lessons/new');await expect(page.locator('#results [data-add]')).toHaveCount(7);await shot(page,'builder-empty');
      await page.locator('[data-add="e2e-core-math"]').click();await expect(page.locator('[data-add="e2e-core-math"]')).toBeDisabled();
      await page.locator('#library-back').click();await expect(page.getByRole('dialog')).toContainText('Save changes before leaving?');await shot(page,'unsaved-exit');await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.locator('#lesson-title').fill(`Algebra workshop ${size}`);await page.locator('#save-lesson').click();await expect(page.locator('#save-status')).toHaveText('Saved');
      await page.locator('[data-edit-item="0"]').click();await page.locator('#lesson-notes').fill('**Look for structure** \\(x^2\\)');await expect(page.locator('#notes-preview .katex')).toHaveCount(1);await shot(page,'builder-editor');
      await page.locator('#custom-time').fill('0:01');await page.locator('#custom-time').press('Tab');await expect(page.locator('#time-error')).toContainText('Use mm:ss');await shot(page,'builder-time-error');
      await page.locator('#custom-time').fill('1:30');await page.locator('#custom-time').press('Tab');await page.locator('#close-editor').click();await shot(page,'builder');
      await page.locator('[data-preview="e2e-core-rw"]').click();await shot(page,'builder-preview');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
      await page.locator('#save-start').click();await expect(page.locator('#join-result .join-code')).toBeVisible();await shot(page,'builder-session-created');
      const lessonId=page.url().match(/lessons\/(\d+)/)[1];
      await page.locator('#library-back').click();await expect(page.locator(`[data-edit="${lessonId}"]`)).toBeVisible();await shot(page,'library');
      await page.locator(`[data-past="${lessonId}"]`).click();await expect(page.locator(`#past-${lessonId}`)).toContainText('Results unavailable');await shot(page,'past-sessions');
      await page.locator(`[data-delete="${lessonId}"]`).click();await expect(page.getByRole('dialog')).toContainText(`Algebra workshop ${size}`);await shot(page,'delete-confirmation');
      await page.getByRole('button',{name:'Delete lesson',exact:true}).click();await expect(page.locator(`[data-edit="${lessonId}"]`)).toHaveCount(0);
      const sessions=await (await context.request.get(`/api/admin/lessons/${lessonId}/sessions`)).json();expect(sessions.length).toBe(1);
      await page.goto('/admin/live');await expect(page.getByRole('link',{name:'Open live room'}).first()).toBeVisible();await shot(page,'live-rooms');
      await page.route('**/api/admin/lessons*',route=>route.fulfill({json:[]}));await page.goto('/admin/live');await expect(page.locator('#body')).toContainText('No open rooms.');await shot(page,'live-rooms-empty');
      await page.goto('/admin/lessons');await expect(page.locator('#body')).toContainText('No lessons yet.');await shot(page,'library-empty');await page.unroute('**/api/admin/lessons*');
      for(const [url,api,name] of [['/admin','**/api/admin/students?*','students'],['/admin/lessons','**/api/admin/lessons','library'],['/admin/lessons/999999/edit','**/api/admin/lessons/999999','builder'],['/admin/questions','**/api/admin/questions?*','bank'],['/admin/live/999999','**/api/lessons/999999','live']]) {
        await page.route(api,route=>route.fulfill({status:503,json:{error:'Service unavailable'}}));await page.goto(url);await expect(page.getByRole('alert').filter({hasText:'Service unavailable'})).toHaveCount(1);await shot(page,`${name}-error`);await page.unroute(api);
      }
      // Untitled drafts must be discardable even though Save correctly rejects them.
      await page.goto('/admin/lessons/new');await page.locator('[data-add="e2e-core-math"]').click();await page.locator('#library-back').click();await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Title required');await shot(page,'unsaved-save-error');await page.getByRole('button',{name:'Discard',exact:true}).click();await expect(page).toHaveURL(/\/admin\/lessons$/);
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test(`live presenter states ${size}`, async ({browser}) => {
    test.setTimeout(90000);mkdirSync(`${artifact}/${size}`,{recursive:true});
    const admin=await newUserContext(browser,'e2e-admin',{viewport});const student=await newUserContext(browser,'e2e-student-4');
    try {
      const lesson=await post(admin,'/api/admin/lessons',{title:'Words, evidence & algebra',mode:'instructor',items:[{question_id:'e2e-ai-rw',time_limit_sec:90,notes:'**Teaching note**: compare the evidence.'},{question_id:'e2e-core-spr',time_limit_sec:90,notes:''}]});
      const session=await post(admin,`/api/admin/lessons/${lesson.id}/sessions`);
      const page=await admin.newPage();const pupil=await student.newPage();await page.goto(`/admin/live/${session.sessionId}`);await expect(page.locator('#live-link')).toHaveText('Connected');await shot(page,'lobby-empty');
      await pupil.goto(`/app?join=${session.joinCode}`);await expect(page.locator('#live-roster')).toContainText('E2E Student 4');await shot(page,'lobby');
      await page.locator('[data-live="start"]').click();await expect(page.locator('#live-card')).toHaveAttribute('data-ready','true');await expect(page.locator('#body')).toContainText('ANSWERING');await expect(page.locator('#live-tools')).toHaveCount(0);await shot(page,'live-answering');
      await pupil.locator('[data-lesson-choice="A"]').click();await expect(page.locator('[data-response="e2e-student-4"]')).toContainText('selected');
      await page.locator('[data-live="endNow"]').click();await expect(page.locator('.distribution')).toBeVisible();await shot(page,'live-revealed');
      await page.locator('[data-group="0"]').click();await expect(page.locator('#live-group')).toContainText('E2E Student 4');await shot(page,'distribution-popover');await page.getByRole('button',{name:'Close distribution details'}).click();
      await page.locator('[data-tool="pen"]').click();await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#live-card')).toHaveCSS('cursor','crosshair');await page.getByRole('button',{name:'Color #75dbaa',exact:true}).click();await shot(page,'annotation-active');
      await page.keyboard.press('Escape');await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed','false');
      await page.locator('.instructor-drawer summary').click();await expect(page.locator('.instructor-drawer')).toContainText('Teaching note');await shot(page,'instructor-drawer');await page.locator('.instructor-drawer summary').click();
      await page.locator('[data-tool="clear"]').click();await shot(page,'annotation-clear-confirmation');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
      await page.locator('[data-live="next"]').click();await expect(page.locator('[data-live="startQuestion"]')).toBeVisible();await shot(page,'live-ready');
      await page.locator('[data-live="startQuestion"]').click();await pupil.locator('#lesson-grid').fill('1/2');await expect(page.locator('[data-response="e2e-student-4"]')).toContainText('1/2');await shot(page,'live-spr-answering');
      await page.locator('[data-live="endNow"]').click();await expect(page.locator('[data-group="0"]')).toContainText('0.5');await page.locator('[data-group="0"]').click();await shot(page,'live-spr-distribution');
      await page.locator('[data-live="endSession"]').click();await expect(page.locator('#body')).toContainText('ENDED');await shot(page,'live-ended');
    } finally {await student.close();await admin.close();}
  });
}
