import { selectDataSource } from '@/shared/api/dataSource'
import { httpMaterialDownloadService } from './httpMaterialDownloadService'
import type { MaterialDownloadRequest, MaterialDownloadService } from './materialDownloadService.interface'
import { mockMaterialDownloadService } from './mockMaterialDownloadService'

const materialDownloadService = selectDataSource<MaterialDownloadService>(
  mockMaterialDownloadService,
  httpMaterialDownloadService,
)

export const fetchMaterial = (request: MaterialDownloadRequest) =>
  materialDownloadService.fetchMaterial(request)

export { materialDownloadPath } from './materialDownloadPath'
export type {
  MaterialDownloadRequest,
  MaterialDownloadScope,
  MaterialDownloadService,
} from './materialDownloadService.interface'
