const getInputIds = async ({ page }) => {
    try {
        const inputIds = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input');
            return Array.from(inputs)
                .filter(input => input.id)
                .map(input => input.id);
        });
        return inputIds;
    } catch (error) {
        return [];
    }
};

// Herramienta para insertar valor en un input por ID
const insertInputValue = async ({ page, inputId, value }) => {
    try {
        await page.waitForSelector(`#${inputId}`);
        await page.fill(`#${inputId}`, value);
        return {
            status: "success",
            message: `Value successfully inserted into input with ID: ${inputId}`
        };
    } catch (error) {
        return {
            status: "error",
            message: `Failed to insert value: ${error.message}`
        };
    }
};

async function getButtonElements({ page }) {
  try {
    const buttonElements = await page.evaluate(() => {
      // Get all button elements (both regular and custom)
      const elements = document.querySelectorAll('button, app-button');
      
      // Convert elements to array of objects with their HTML
      return Array.from(elements).map(el => ({
        buttonHTML: el.outerHTML,
        type: el.tagName.toLowerCase(),
        text: el.textContent.trim()
      }));
    });

    return {
      success: true,
      buttons: buttonElements,
      message: `Found ${buttonElements.length} button elements`
    };
  } catch (error) {
    return {
      success: false,
      buttons: [],
      message: `Error getting button elements: ${error.message}`
    };
  }
}


async function getAnchorElements({ page }) {
  try {
    const anchorElements = await page.evaluate(() => {
      // Get all anchorElements elements (both regular and custom)
      const elements = document.querySelectorAll('a');
      
      // Convert elements to array of objects with their HTML
      return Array.from(elements).map(el => ({
        buttonHTML: el.outerHTML,
        type: el.tagName.toLowerCase(),
        text: el.textContent.trim()
      }));
    });

    return {
      success: true,
      anchorElements: anchorElements,
      message: `Found ${anchorElements.length} anchor elements`
    };
  } catch (error) {
    return {
      success: false,
      anchorElements: [],
      message: `Error getting button elements: ${error.message}`
    };
  }
}

async function getTable({ page }) {
  try {
    const tableElements = await page.evaluate(() => {
      // Get all table elements
      const elements = document.querySelectorAll('table');
      
      // Convert elements to array of objects with their HTML
      return Array.from(elements).map(el => ({
        tableHTML: el.outerHTML,
      }));
    });

    return {
      success: true,
      tableElements: tableElements,
      message: `Found ${tableElements.length} table elements`
    };
  } catch (error) {
    return {
      success: false,
      tableElements: [],
      message: `Error getting table elements: ${error.message}`
    };
  }
}

// Don't forget to add it to your exports
export {
    getInputIds,
    insertInputValue,
    getButtonElements,
    getAnchorElements,
    getTable
};