// Building tint is a separate Garage document, never a vehicle invoice.
export type BuildingWall = 'N' | 'E' | 'S' | 'W';
export interface BuildingFloor { id: string; name: string }
export interface BuildingRoom { id: string; floorId: string; name: string; width: number; depth: number; x: number; z: number }
export interface BuildingPane { id: string; width: number; height: number; measured: boolean; shape: 'rect' | 'custom'; verifiedArea?: number; photoReference?: string; note?: string; row?: number; col?: number }
export interface BuildingWindow { id: string; roomId: string; label: string; kind: 'window' | 'sliding' | 'custom'; wall: BuildingWall; position: number; film: string; panes: BuildingPane[]; span?: { toFloorId: string; rows: number; cols: number; bottom: number } }
export interface BuildingQuoteVersion { id: string; number: number; createdAt: string; note: string; sqft: number; unchecked: number; rooms: BuildingRoom[]; windows: BuildingWindow[]; customerName: string; address: string }
export interface BuildingProject { schema: 1; id: string; ownerId: string; customerId?: string; customerName: string; phone: string; title: string; address: string; floors: BuildingFloor[]; rooms: BuildingRoom[]; windows: BuildingWindow[]; versions: BuildingQuoteVersion[]; revision: number; createdAt: string; updatedAt: string }
export interface BuildingProjectRecord { project: BuildingProject; savedAt: string }
