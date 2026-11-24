export async function openVaultSection(page, name) {
  const button = page.getByRole("dialog", { name: "설정", exact: true }).getByRole("button", { name, exact: true });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}
