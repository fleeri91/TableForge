import TableRow from './TableRow'

import { useTableStore } from '../../store/useTable'

const Table = () => {
  const { rows, columns, headerRow, setRows, setColumns } = useTableStore()

  const handleAddRow = () => {
    setRows(rows + 1)
  }

  const handleAddColumn = () => {
    setColumns(columns + 1)
  }

  return (
    <div className="mx-auto max-w-screen-xl p-8">
      <div className="mb-4 flex justify-end">
        <button
          onClick={handleAddRow}
          className="mr-2 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Add Row
        </button>
        <button
          onClick={handleAddColumn}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Add Column
        </button>
      </div>
      <table className="w-full border-collapse border">
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow
              key={rowIndex}
              rowIndex={rowIndex}
              isHeaderRow={headerRow && rowIndex === 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default Table
