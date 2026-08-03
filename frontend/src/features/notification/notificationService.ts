import { selectDataSource } from '@/shared/api/dataSource'
import { httpNotificationService } from './httpNotificationService'
import { mockNotificationService } from './mockNotificationService'
import type { NotificationService } from './notificationService.interface'
import type { NotificationListQuery } from './types'

const notificationService = selectDataSource<NotificationService>(
  mockNotificationService,
  httpNotificationService,
)

export const getNotificationSummary = () => notificationService.getSummary()
export const getNotifications = (query?: NotificationListQuery) =>
  notificationService.getNotifications(query)
export const markNotificationAsRead = (notificationId: string) =>
  notificationService.markAsRead(notificationId)
export const markAllNotificationsAsRead = () => notificationService.markAllAsRead()
export const resolveNotificationTarget = (notificationId: string) =>
  notificationService.resolveTarget(notificationId)
export const subscribeNotifications = (onSignal: Parameters<NotificationService['subscribeNotifications']>[0]) =>
  notificationService.subscribeNotifications(onSignal)

export const getPushPublicKey = () => notificationService.getPushPublicKey()
export const registerPushSubscription = (
  subscription: Parameters<NotificationService['registerPushSubscription']>[0],
) => notificationService.registerPushSubscription(subscription)
export const unregisterPushSubscription = (endpoint: string) =>
  notificationService.unregisterPushSubscription(endpoint)

export type { NotificationService } from './notificationService.interface'
