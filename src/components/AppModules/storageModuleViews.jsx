/* =========================================================================
   src/components/AppModules/storageModuleViews.jsx
   Storage & Boxes module views (StorageFinder + StorageList + StorageDetail),
   extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';
import { StorageFinder } from './storageModules';
import { StorageList, StorageDetail } from '../Storage';

export const StorageModule = ({
  currentModule, tests, setTests, storages, operatorNames,
  setActiveTestId, setCurrentModule, setActiveStorageId, setStorageModal,
  handlePrint, activeStorageId, jumpToTest, setMoveModal, createEmptyTest
}) => (
  <>

  <div className="h-full min-h-0 flex flex-col overflow-hidden bg-slate-50">
    <StorageFinder
      tests={tests}
      storages={storages}
      operators={operatorNames}
      onOpenTest={(testId) => {
        setActiveTestId(testId);
        setCurrentModule('active-test');
      }}
      onOpenStorage={(storageId) => {
        if (!storageId) return;
        setActiveStorageId(storageId);
        setCurrentModule('storage-detail');
      }}
    />

    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <StorageList
        storages={storages}
        tests={tests}
        setStorageModal={setStorageModal}
        setActiveStorageId={setActiveStorageId}
        setCurrentModule={setCurrentModule}
        handlePrint={handlePrint}
        operators={operatorNames}
      />
    </div>
  </div>
              <StorageDetail
                storages={storages}
                activeStorageId={activeStorageId}
                tests={tests}
                setTests={setTests}
                setCurrentModule={setCurrentModule}
                handlePrint={handlePrint}
                jumpToTest={jumpToTest}
                setMoveModal={setMoveModal}
                createEmptyTest={createEmptyTest}
                setActiveTestId={setActiveTestId}
                operators={operatorNames}
              />
  </>
);
