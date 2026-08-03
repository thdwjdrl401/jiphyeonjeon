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

export type { NotificationService } from './notificationService.interface'
