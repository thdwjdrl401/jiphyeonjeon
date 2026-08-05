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
export const subscribeNotifications = (
  onSignal: Parameters<NotificationService['subscribeNotifications']>[0],
  onConnected?: Parameters<NotificationService['subscribeNotifications']>[1],
) => notificationService.subscribeNotifications(onSignal, onConnected)

export const getPushPublicKey = () => notificationService.getPushPublicKey()
export const registerPushSubscription = (
  subscription: Parameters<NotificationService['registerPushSubscription']>[0],
) => notificationService.registerPushSubscription(subscription)
export const unregisterPushSubscription = (endpoint: string) =>
  notificationService.unregisterPushSubscription(endpoint)

export const getNotificationLeadTimes = () => notificationService.getNotificationLeadTimes()
export const getNotificationPreference = (curriculumId: string, lessonId?: string) =>
  notificationService.getNotificationPreference(curriculumId, lessonId)
export const saveNotificationPreference = (
  input: Parameters<NotificationService['saveNotificationPreference']>[0],
) => notificationService.saveNotificationPreference(input)

export type { NotificationService } from './notificationService.interface'
