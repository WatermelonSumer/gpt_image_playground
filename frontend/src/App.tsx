import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './authStore'
import { initStore, useStore } from './store'
import { useModelsStore } from './modelsStore'
import AdminPage from './components/admin/AdminPage'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import LoginPage, { AuthLoadingScreen } from './components/LoginPage'

export default function App() {
  const auth = useAuthStore((state) => state.auth)
  const restoreSession = useAuthStore((state) => state.restoreSession)

  useEffect(() => {
    void restoreSession()
  }, [restoreSession])

  if (auth.status === 'checking') return <AuthLoadingScreen />
  if (auth.status === 'anonymous') return <LoginPage />
  return <AuthedApp isSuperAdmin={auth.user.role === 'super_admin'} />
}

function AuthedApp({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  useEffect(() => {
    initStore()
    void useModelsStore.getState().load()
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Workspace />} />
        <Route
          path="/admin"
          element={isSuperAdmin ? <AdminPage /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

function Workspace() {
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  useGlobalClickSuppression()

  return (
    <>
      <Header />
      <main data-home-main data-drag-select-surface className="pb-48">
        <div className="safe-area-x max-w-7xl mx-auto">
          <SearchBar />
          {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
        </div>
      </main>
      <InputBar />
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
