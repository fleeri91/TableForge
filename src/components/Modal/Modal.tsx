import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'

interface ModalProps {
  children?: React.ReactNode
  title?: string
  description?: string
  isOpen: boolean
  setIsOpen: (value: boolean) => void
}

const Modal = ({ children, title, description, isOpen, setIsOpen }: ModalProps): JSX.Element => (
  <Dialog open={isOpen} onClose={() => setIsOpen(false)} className="relative z-50">
    <DialogBackdrop
      transition
      className="fixed inset-0 bg-black/30 duration-300 ease-out data-[closed]:opacity-0"
    />
    <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
      <DialogPanel
        transition
        className="max-w-lg space-y-4 rounded-lg bg-white p-12 duration-300 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        {title && <DialogTitle className="text-lg font-bold">{title}</DialogTitle>}
        {description && <Description>{description}</Description>}
        {children && children}
      </DialogPanel>
    </div>
  </Dialog>
)

export default Modal
