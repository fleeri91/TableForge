import { useTableStore } from '../../../store/useTable'
import TableData from '../TableData'

interface TableRowProps {
  rowIndex: number
  isHeaderRow: boolean
}

const TableRow = ({ rowIndex, isHeaderRow }: TableRowProps) => {
  const { columns, headerColumn } = useTableStore()

  return (
    <tr>
      {Array.from({ length: columns }).map((_, colIndex) => (
        <TableData
          key={colIndex}
          row={rowIndex}
          col={colIndex}
          isHeader={isHeaderRow || (headerColumn && colIndex === 0)}
        />
      ))}
    </tr>
  )
}

export default TableRow
