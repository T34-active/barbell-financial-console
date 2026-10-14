import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/dashboard/index.vue'),
      meta: { title: '总览' },
    },
    {
      path: '/accounts',
      name: 'accounts',
      component: () => import('@/views/accounts/index.vue'),
      redirect: { name: 'accounts-rmb' },
      meta: { title: '账户' },
      children: [
        {
          path: 'rmb',
          name: 'accounts-rmb',
          component: () => import('@/views/accounts/rmb/index.vue'),
          meta: { title: '人民币安全' },
        },
        {
          path: 'hkd',
          name: 'accounts-hkd',
          component: () => import('@/views/accounts/hkd/index.vue'),
          meta: { title: '港币池' },
        },
        {
          path: 'us',
          name: 'accounts-us',
          component: () => import('@/views/accounts/us/index.vue'),
          meta: { title: '美股池' },
        },
        {
          path: 'neutral',
          name: 'accounts-neutral',
          component: () => import('@/views/accounts/neutral/index.vue'),
          meta: { title: '中性+加密赌注' },
        },
      ],
    },
    {
      path: '/salary',
      name: 'salary',
      component: () => import('@/views/salary/index.vue'),
      meta: { title: '工资' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/settings/index.vue'),
      meta: { title: '设置' },
    },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : 'Console'
  document.title = `${title} · Personal Barbell`
})

export default router
