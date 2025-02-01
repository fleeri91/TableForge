import { useTableStore } from '../../../store/useTable'

interface TableDataProps {
  row: number
  col: number
  isHeader: boolean
}

const TableData = ({ row, col, isHeader }: TableDataProps) => {
  const { data, updateCell } = useTableStore()

  return (
    <td className={isHeader ? 'bg-gray-300 font-bold' : 'bg-gray-100'}>
      <input
        type="text"
        value={data[row][col]}
        className="w-full border border-gray-700 p-2 outline-none"
        onChange={(e) => updateCell(row, col, e.target.value)}
      />
    </td>
  )
}

export default TableData
