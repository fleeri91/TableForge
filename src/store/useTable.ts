import { create } from 'zustand'

type CellData = string

type TableState = {
  rows: number
  columns: number
  headerRow: boolean
  headerColumn: boolean
  data: CellData[][]
}

type TableActions = {
  setRows: (value: number) => void
  setColumns: (value: number) => void
  setHeaderRow: (value: boolean) => void
  setHeaderColumn: (value: boolean) => void
  updateCell: (row: number, col: number, value: string) => void
}

const initialState: TableState = {
  rows: 3,
  columns: 3,
  headerRow: true,
  headerColumn: true,
  data: Array.from({ length: 3 }, () => Array(3).fill('')),
}

export const useTableStore = create<TableState & TableActions>((set) => ({
  ...initialState,
  setRows: (value) =>
    set((state) => ({
      ...state,
      rows: value,
      data: Array.from({ length: value }, (_, r) =>
        Array.from({ length: state.columns }, (_, c) => state.data[r]?.[c] || '')
      ),
    })),
  setColumns: (value) =>
    set((state) => ({
      ...state,
      columns: value,
      data: state.data.map((row) => Array.from({ length: value }, (_, c) => row[c] || '')),
    })),
  setHeaderRow: (value) => set((state) => ({ ...state, headerRow: value })),
  setHeaderColumn: (value) => set((state) => ({ ...state, headerColumn: value })),
  updateCell: (row, col, value) =>
    set((state) => {
      const newData = [...state.data]
      newData[row][col] = value
      return { ...state, data: newData }
    }),
}))
