// ให้เปิดเป็น Side Panel เสมอเพื่อความสะดวกในการลากวาง
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error setting panel behavior:", error));