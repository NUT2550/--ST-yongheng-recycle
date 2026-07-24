import { describe, expect, test } from 'bun:test'
import {
  canAccessPage,
  hasPermission,
  PAGE_CREATE_PERMISSIONS,
  type AuthPayload,
} from '../src/lib/permissions'

const staff = (permissions: Record<string, boolean>): AuthPayload => ({
  userId: 'staff-1',
  username: '04',
  name: 'พนักงาน ยงเฮง',
  role: 'staff',
  permissions,
})

describe('ST-69 authorization consistency', () => {
  test('Sorting UI capability and API helper both deny staff without sort.create', () => {
    const user = staff({ 'customer.create': true })
    expect(canAccessPage(user, 'sort')).toBe(false)
    expect(hasPermission(user, 'sort.create')).toBe(false)
  })

  test('Sorting UI capability and API helper both allow staff with sort.create', () => {
    const user = staff({ 'customer.create': true, 'sort.create': true })
    expect(canAccessPage(user, 'sort')).toBe(true)
    expect(hasPermission(user, 'sort.create')).toBe(true)
  })

  test('admin has implicit access to every declared mutation page', () => {
    const admin: AuthPayload = {
      userId: 'admin-1',
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      permissions: {},
    }
    for (const page of Object.keys(PAGE_CREATE_PERMISSIONS)) {
      expect(canAccessPage(admin, page)).toBe(true)
    }
  })

  test('authenticated read-only pages remain available without create permissions', () => {
    const user = staff({})
    for (const page of ['dashboard', 'stock', 'credit', 'bonus', 'history']) {
      expect(canAccessPage(user, page)).toBe(true)
    }
  })

  test('all declared page capabilities use the canonical permission contract', () => {
    expect(PAGE_CREATE_PERMISSIONS).toEqual({
      buy: 'buy.create',
      sell: 'sell.create',
      sort: 'sort.create',
      transfer: 'transfer.create',
      'daily-weighing': 'dailyPurchaseWeighing',
    })
  })
})
